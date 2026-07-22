import { generateText } from "ai";
import { getModel } from "@/lib/ai-gateway.server";
import { getRawFile, getRepoTree, type GhFile } from "@/lib/github.server";

export type Finding = {
  agent: "dependency" | "dead_code" | "test_coverage";
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  detail?: string;
  file_path?: string;
  metadata?: Record<string, unknown>;
};

export type GeneratedTest = {
  source_file: string;
  target_function?: string;
  language: string;
  test_code: string;
};

// ── Dependency Agent ─────────────────────────────────────────────
async function fetchLatestNpm(name: string): Promise<string | null> {
  try {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
    if (!r.ok) return null;
    return ((await r.json()) as { version?: string }).version ?? null;
  } catch { return null; }
}
async function fetchLatestPypi(name: string): Promise<string | null> {
  try {
    const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (!r.ok) return null;
    return ((await r.json()) as { info?: { version?: string } }).info?.version ?? null;
  } catch { return null; }
}
function cleanVer(v: string): string { return v.replace(/^[\^~>=<\s]+/, "").split(",")[0].trim(); }
function isOutdated(current: string, latest: string): boolean {
  const c = cleanVer(current).split(".").map((n) => parseInt(n) || 0);
  const l = latest.split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export async function runDependencyAgent(token: string, full: string, branch: string, tree: GhFile[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const pkgPath = tree.find((f) => f.path === "package.json")?.path;
  if (pkgPath) {
    const raw = await getRawFile(token, full, branch, pkgPath);
    if (raw) {
      try {
        const pkg = JSON.parse(raw);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const entries = Object.entries(deps).slice(0, 40);
        const results = await Promise.all(entries.map(async ([n, v]) => ({ n, v: String(v), latest: await fetchLatestNpm(n) })));
        for (const { n, v, latest } of results) {
          if (latest && isOutdated(v, latest)) {
            findings.push({
              agent: "dependency", severity: "medium",
              title: `${n} is outdated`,
              detail: `Current: ${v} · Latest: ${latest}`,
              file_path: "package.json",
              metadata: { name: n, current: v, latest },
            });
          }
        }
      } catch { /* ignore */ }
    }
  }
  const reqPath = tree.find((f) => f.path === "requirements.txt")?.path;
  if (reqPath) {
    const raw = await getRawFile(token, full, branch, reqPath);
    if (raw) {
      const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).slice(0, 40);
      const parsed = lines.map((l) => {
        const m = l.match(/^([A-Za-z0-9_.\-]+)\s*([=<>!~]{1,2})?\s*([\w.\-]+)?/);
        return m ? { name: m[1], version: m[3] || "" } : null;
      }).filter(Boolean) as { name: string; version: string }[];
      const results = await Promise.all(parsed.map(async (p) => ({ ...p, latest: await fetchLatestPypi(p.name) })));
      for (const { name, version, latest } of results) {
        if (latest && version && isOutdated(version, latest)) {
          findings.push({
            agent: "dependency", severity: "medium",
            title: `${name} is outdated`,
            detail: `Current: ${version} · Latest: ${latest}`,
            file_path: "requirements.txt",
            metadata: { name, current: version, latest },
          });
        }
      }
    }
  }
  if (findings.length === 0) {
    findings.push({ agent: "dependency", severity: "info", title: "No outdated dependencies detected", detail: "All parsed dependencies are on their latest version, or no manifest was found." });
  }
  return findings;
}

// ── Dead Code Agent ─────────────────────────────────────────────
const SRC_RX = /\.(ts|tsx|js|jsx|py)$/;

export async function runDeadCodeAgent(token: string, full: string, branch: string, tree: GhFile[]): Promise<Finding[]> {
  const srcFiles = tree.filter((f) => SRC_RX.test(f.path) && !/node_modules|dist|build|\.next|__pycache__/.test(f.path)).slice(0, 30);
  if (srcFiles.length === 0) {
    return [{ agent: "dead_code", severity: "info", title: "No source files detected", detail: "Nothing to scan." }];
  }
  const samples = await Promise.all(
    srcFiles.slice(0, 12).map(async (f) => {
      const raw = await getRawFile(token, full, branch, f.path);
      return { path: f.path, content: raw?.slice(0, 4000) ?? "" };
    }),
  );
  const listing = samples.map((s) => `--- ${s.path} ---\n${s.content}`).join("\n\n").slice(0, 30000);
  const { text } = await generateText({
    model: getModel(),
    system: `You are a senior code reviewer. Identify likely dead code: unused exports, unreferenced functions, unreachable branches, commented-out blocks kept "just in case". Only flag high-confidence items. Respond as a JSON array of {title, detail, file_path, severity}. severity ∈ {"low","medium","high"}. Max 10 items. Return ONLY JSON, no prose.`,
    prompt: `Repo: ${full}\n\nSampled files:\n${listing}`,
  });
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const arr = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    return (Array.isArray(arr) ? arr : []).slice(0, 10).map((x: Record<string, unknown>) => ({
      agent: "dead_code" as const,
      severity: (["low", "medium", "high"].includes(String(x.severity)) ? x.severity : "low") as Finding["severity"],
      title: String(x.title ?? "Dead code candidate"),
      detail: x.detail ? String(x.detail) : undefined,
      file_path: x.file_path ? String(x.file_path) : undefined,
    }));
  } catch {
    return [{ agent: "dead_code", severity: "info", title: "Dead-code scan complete", detail: text.slice(0, 800) }];
  }
}

// ── Test Coverage Agent ─────────────────────────────────────────
export async function runTestCoverageAgent(
  token: string, full: string, branch: string, tree: GhFile[],
): Promise<{ findings: Finding[]; tests: GeneratedTest[] }> {
  const src = tree.filter((f) => SRC_RX.test(f.path) && !/node_modules|dist|build|\.next|__pycache__|\.test\.|\.spec\.|_test\.py|tests?\//i.test(f.path));
  const testFiles = tree.filter((f) => /\.test\.|\.spec\.|_test\.py|tests?\//i.test(f.path));
  const testedStems = new Set(testFiles.map((f) => f.path.replace(/\.(test|spec)\.[jt]sx?$|_test\.py$/i, "").split("/").pop()!));
  const uncovered = src.filter((f) => {
    const stem = f.path.split("/").pop()!.replace(/\.[jt]sx?$|\.py$/, "");
    return !testedStems.has(stem);
  }).slice(0, 8);

  const findings: Finding[] = [{
    agent: "test_coverage", severity: uncovered.length > 5 ? "high" : uncovered.length > 0 ? "medium" : "info",
    title: `${uncovered.length} source file(s) appear to have no matching test`,
    detail: uncovered.length
      ? `Files without a sibling *.test.* or *.spec.* file:\n${uncovered.map((f) => `• ${f.path}`).join("\n")}`
      : "Every source file has a corresponding test file (heuristic match).",
    metadata: { uncovered: uncovered.map((f) => f.path) },
  }];

  const tests: GeneratedTest[] = [];
  const targets = uncovered.slice(0, 3);
  for (const f of targets) {
    const raw = await getRawFile(token, full, branch, f.path);
    if (!raw) continue;
    const isPy = f.path.endsWith(".py");
    const { text } = await generateText({
      model: getModel(),
      system: `You write focused, runnable unit tests. Output ONLY the test file body — no fences, no prose. Prefer ${isPy ? "pytest" : "Vitest"}. Cover the primary exported function(s) with 2-4 assertions each.`,
      prompt: `File: ${f.path}\n\n\`\`\`\n${raw.slice(0, 6000)}\n\`\`\`\n\nWrite the test file.`,
    });
    tests.push({
      source_file: f.path,
      language: isPy ? "python" : "typescript",
      test_code: text.replace(/^```[a-z]*\n?|```$/gm, "").trim(),
    });
  }
  return { findings, tests };
}
