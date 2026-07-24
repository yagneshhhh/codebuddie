import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Save/disconnect GitHub PAT ──────────────────────────────────
export const saveGithubToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().min(20) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptToken } = await import("@/lib/crypto.server");
    const { getViewer } = await import("@/lib/github.server");
    const viewer = await getViewer(data.token);
    await supabaseAdmin.from("github_tokens").upsert({
      user_id: context.userId,
      token_ciphertext: encryptToken(data.token),
      github_login: viewer.login,
      updated_at: new Date().toISOString(),
    });
    return { login: viewer.login };
  });

export const disconnectGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("github_tokens").delete().eq("user_id", context.userId);
    return { ok: true };
  });

export const getGithubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("github_tokens").select("github_login").eq("user_id", context.userId).maybeSingle();
    return { connected: !!data, login: data?.github_login ?? null };
  });

async function getToken(userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptToken } = await import("@/lib/crypto.server");
  const { data, error } = await supabaseAdmin
    .from("github_tokens").select("token_ciphertext").eq("user_id", userId).maybeSingle();
  if (error || !data) throw new Error("GitHub not connected");
  return decryptToken(data.token_ciphertext);
}

export const listMyGithubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listUserRepos } = await import("@/lib/github.server");
    const token = await getToken(context.userId);
    const repos = await listUserRepos(token);
    return repos.map((r) => ({
      full_name: r.full_name, default_branch: r.default_branch,
      description: r.description, language: r.language, private: r.private,
    }));
  });

export const addRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    full_name: z.string(), default_branch: z.string().default("main"),
    description: z.string().nullable().optional(), language: z.string().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("repos").upsert({
      user_id: context.userId, github_full_name: data.full_name,
      default_branch: data.default_branch, description: data.description ?? null, language: data.language ?? null,
    }, { onConflict: "user_id,github_full_name" }).select("id").single();
    if (error) throw error;
    return { id: row.id };
  });

export const listRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("repos").select("*").order("created_at", { ascending: false });
    return data ?? [];
  });

export const getRepo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: repo } = await context.supabase.from("repos").select("*").eq("id", data.id).maybeSingle();
    const { data: analyses } = await context.supabase.from("analyses").select("*").eq("repo_id", data.id).order("started_at", { ascending: false });
    return { repo, analyses: analyses ?? [] };
  });

// ── Run analysis (orchestrator) ─────────────────────────────────
export const runAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ repoId: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRepoTree, getRawFile } = await import("@/lib/github.server");
    const { runDependencyAgent, runDeadCodeAgent, runTestCoverageAgent } = await import("@/lib/agents/agents.server");
    const { embedMany, toVectorLiteral } = await import("@/lib/embeddings.server");

    const { data: repo, error: rErr } = await context.supabase
      .from("repos").select("*").eq("id", data.repoId).maybeSingle();
    if (rErr || !repo) throw new Error("Repo not found");

    const { data: analysis } = await supabaseAdmin.from("analyses").insert({
      repo_id: repo.id, user_id: context.userId, status: "running",
    }).select("id").single();
    const analysisId = analysis!.id;

    try {
      const token = await getToken(context.userId);
      const tree = await getRepoTree(token, repo.github_full_name, repo.default_branch);

      const [dep, dead, cov] = await Promise.all([
        runDependencyAgent(token, repo.github_full_name, repo.default_branch, tree),
        runDeadCodeAgent(token, repo.github_full_name, repo.default_branch, tree),
        runTestCoverageAgent(token, repo.github_full_name, repo.default_branch, tree),
      ]);

      const allFindings = [...dep, ...dead, ...cov.findings];
      if (allFindings.length) {
        await supabaseAdmin.from("findings").insert(allFindings.map((f) => ({
          analysis_id: analysisId, user_id: context.userId,
          agent: f.agent, severity: f.severity, title: f.title,
          detail: f.detail ?? null, file_path: f.file_path ?? null,
          metadata: (f.metadata ?? null) as never,
        })));
      }
      if (cov.tests.length) {
        await supabaseAdmin.from("generated_tests").insert(cov.tests.map((t) => ({
          analysis_id: analysisId, user_id: context.userId,
          source_file: t.source_file, target_function: t.target_function ?? null,
          language: t.language, test_code: t.test_code,
        })));
      }
      // ── Build & embed RAG chunks (findings + tests + sampled code) ──
      type Chunk = { kind: string; source: string; content: string; metadata?: Record<string, unknown> };
      const chunks: Chunk[] = [];
      for (const f of allFindings) {
        chunks.push({
          kind: "finding",
          source: f.file_path ?? f.agent,
          content: `[${f.agent}/${f.severity}] ${f.title}\n${f.detail ?? ""}${f.file_path ? `\nFile: ${f.file_path}` : ""}`,
          metadata: { agent: f.agent, severity: f.severity, file_path: f.file_path },
        });
      }
      for (const t of cov.tests) {
        chunks.push({
          kind: "generated_test",
          source: t.source_file,
          content: `Generated ${t.language} test for ${t.source_file}:\n${t.test_code.slice(0, 3000)}`,
          metadata: { source_file: t.source_file, language: t.language },
        });
      }
      // Sample up to 8 source files (chunked to ~2000 chars each) for code context.
      const SRC_RX = /\.(ts|tsx|js|jsx|py|md)$/;
      const codeFiles = tree
        .filter((f) => SRC_RX.test(f.path) && !/node_modules|dist|build|\.next|__pycache__/.test(f.path))
        .slice(0, 8);
      const raws = await Promise.all(codeFiles.map(async (f) => ({ path: f.path, raw: await getRawFile(token, repo.github_full_name, repo.default_branch, f.path) })));
      for (const { path, raw } of raws) {
        if (!raw) continue;
        const CHUNK = 2000;
        for (let i = 0; i < raw.length && i < 12000; i += CHUNK) {
          chunks.push({
            kind: "code",
            source: path,
            content: `File: ${path} (chars ${i}-${i + CHUNK})\n${raw.slice(i, i + CHUNK)}`,
            metadata: { file_path: path, offset: i },
          });
        }
      }
      if (chunks.length) {
        try {
          const vecs = await embedMany(chunks.map((c) => c.content));
          await supabaseAdmin.from("analysis_chunks").insert(chunks.map((c, i) => ({
            analysis_id: analysisId, user_id: context.userId,
            kind: c.kind, source: c.source, content: c.content,
            metadata: (c.metadata ?? null) as never,
            embedding: toVectorLiteral(vecs[i]) as unknown as never,
          })));
        } catch (embErr) {
          console.error("embedding step failed", embErr);
        }
      }

      const summary = `${dep.length} dep · ${dead.length} dead-code · ${cov.findings.length} coverage · ${cov.tests.length} test(s) generated`;
      await supabaseAdmin.from("analyses").update({
        status: "done", summary, finished_at: new Date().toISOString(),
      }).eq("id", analysisId);
      return { id: analysisId, summary };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("analyses").update({
        status: "failed", error: msg, finished_at: new Date().toISOString(),
      }).eq("id", analysisId);
      throw new Error(msg);
    }
  });

export const getAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: analysis } = await context.supabase.from("analyses").select("*, repos(github_full_name, default_branch)").eq("id", data.id).maybeSingle();
    const { data: findings } = await context.supabase.from("findings").select("*").eq("analysis_id", data.id).order("severity", { ascending: false });
    const { data: tests } = await context.supabase.from("generated_tests").select("*").eq("analysis_id", data.id);
    return { analysis, findings: findings ?? [], tests: tests ?? [] };
  });

// ── Create autonomous PR + comment from analysis ────────────────
export const createAnalysisPR = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ analysisId: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { getBranchSha, createBranch, putFileOnBranch, createPullRequest, createIssueComment } =
      await import("@/lib/github.server");

    const { data: analysis } = await context.supabase
      .from("analyses").select("*, repos(github_full_name, default_branch)")
      .eq("id", data.analysisId).maybeSingle();
    if (!analysis) throw new Error("Analysis not found");
    const repo = (analysis as unknown as { repos: { github_full_name: string; default_branch: string } }).repos;

    const { data: findings } = await context.supabase.from("findings").select("*").eq("analysis_id", data.analysisId);
    const { data: tests } = await context.supabase.from("generated_tests").select("*").eq("analysis_id", data.analysisId);

    const token = await getToken(context.userId);
    const base = repo.default_branch || "main";
    const branch = `sentinel/analysis-${data.analysisId.slice(0, 8)}`;

    // Branch (idempotent: ignore "already exists")
    try {
      const baseSha = await getBranchSha(token, repo.github_full_name, base);
      await createBranch(token, repo.github_full_name, branch, baseSha);
    } catch (e) {
      if (!String(e).includes("already exists") && !String(e).includes("Reference already exists")) throw e;
    }

    // Build markdown report
    const bySev = (findings ?? []).reduce<Record<string, typeof findings>>((acc, f) => {
      (acc[f.severity] ||= [] as unknown as typeof findings)!.push(f); return acc;
    }, {});
    const sevOrder = ["critical", "high", "medium", "low", "info"];
    const md: string[] = [
      `# 🛡️ Sentinel Analysis Report`,
      ``,
      `**Summary:** ${analysis.summary ?? "(no summary)"}`,
      `**Findings:** ${(findings ?? []).length} · **Generated tests:** ${(tests ?? []).length}`,
      ``,
    ];
    for (const sev of sevOrder) {
      const list = bySev[sev]; if (!list?.length) continue;
      md.push(`## ${sev.toUpperCase()} (${list.length})`);
      for (const f of list) {
        md.push(`- **[${f.agent}]** ${f.title}${f.file_path ? ` — \`${f.file_path}\`` : ""}`);
        if (f.detail) md.push(`  > ${String(f.detail).replace(/\n/g, "\n  > ").slice(0, 500)}`);
      }
      md.push("");
    }
    const reportPath = `.sentinel/analysis-${data.analysisId.slice(0, 8)}.md`;
    await putFileOnBranch(token, repo.github_full_name, branch, reportPath, md.join("\n"),
      "chore(sentinel): add analysis report");

    // Commit generated tests
    for (const t of tests ?? []) {
      const src = t.source_file.replace(/\.(ts|tsx|js|jsx)$/, "");
      const ext = /\.(tsx|jsx)$/.test(t.source_file) ? "test.tsx" : t.language === "typescript" ? "test.ts" : "test.js";
      const testPath = `${src}.sentinel.${ext}`;
      try {
        await putFileOnBranch(token, repo.github_full_name, branch, testPath, t.test_code,
          `test(sentinel): add generated tests for ${t.source_file}`);
      } catch (e) { console.error("skip test file", testPath, e); }
    }

    // Open PR
    const prBody = [
      `Automated report from **Sentinel** for analysis \`${data.analysisId}\`.`,
      ``,
      `See [\`${reportPath}\`](../blob/${branch}/${reportPath}) for the full breakdown.`,
      ``,
      md.slice(0, 40).join("\n"),
    ].join("\n");

    const pr = await createPullRequest(token, repo.github_full_name, {
      title: `🛡️ Sentinel: ${(findings ?? []).length} findings · ${(tests ?? []).length} tests`,
      head: branch, base, body: prBody,
    });

    // Autonomous comment (top findings)
    const top = (findings ?? []).filter((f) => ["critical", "high"].includes(f.severity)).slice(0, 10);
    if (top.length) {
      const comment = [`### 🚨 Top ${top.length} high-severity findings`, ``,
        ...top.map((f) => `- **[${f.agent}]** ${f.title}${f.file_path ? ` — \`${f.file_path}\`` : ""}`)].join("\n");
      try { await createIssueComment(token, repo.github_full_name, pr.number, comment); }
      catch (e) { console.error("comment failed", e); }
    }

    return { url: pr.html_url, number: pr.number };
  });

