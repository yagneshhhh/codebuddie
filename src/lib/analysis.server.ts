// Core analysis orchestrator — shared by the manual server function and the
// GitHub push webhook. Runs with the service-role client (no user session).
//
// Orchestration layer responsibilities:
//   • step tracking      → every stage writes a row to `job_events`
//   • fault isolation    → one failing agent never kills the whole run
//   • retries            → per-agent exponential backoff
//   • partial success    → run finishes as `done` / `partial` / `failed`
//   • resumability       → `retryAnalysis` re-runs only what failed

export type AnalysisTrigger = "manual" | "push" | "pull_request" | "workflow" | "retry";
export type AgentName = "dependency" | "dead_code" | "test_coverage";
export type AgentState = "pending" | "running" | "done" | "failed";

export const AGENTS: AgentName[] = ["dependency", "dead_code", "test_coverage"];

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 800;

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** Append a step to the analysis timeline. Never throws — logging must not break a run. */
async function logEvent(
  admin: Admin,
  args: {
    analysisId: string; userId: string; step: string;
    agent?: AgentName | null; status?: "info" | "running" | "done" | "failed" | "retry";
    message?: string | null; durationMs?: number | null; attempt?: number;
  },
) {
  try {
    await admin.from("job_events").insert({
      analysis_id: args.analysisId,
      user_id: args.userId,
      agent: args.agent ?? null,
      step: args.step,
      status: args.status ?? "info",
      message: args.message ?? null,
      duration_ms: args.durationMs ?? null,
      attempt: args.attempt ?? 1,
    });
  } catch (e) {
    console.error("job_events insert failed", e);
  }
}

/** Run one agent with retries + timing, logging every attempt. */
async function runStep<T>(
  admin: Admin,
  ctx: { analysisId: string; userId: string },
  agent: AgentName,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    await logEvent(admin, { ...ctx, agent, step: `${agent}:start`, status: "running", attempt });
    try {
      const value = await fn();
      await logEvent(admin, {
        ...ctx, agent, step: `${agent}:done`, status: "done",
        durationMs: Date.now() - startedAt, attempt,
      });
      return { ok: true, value };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const willRetry = attempt < MAX_ATTEMPTS;
      await logEvent(admin, {
        ...ctx, agent,
        step: willRetry ? `${agent}:retry` : `${agent}:failed`,
        status: willRetry ? "retry" : "failed",
        message: lastError, durationMs: Date.now() - startedAt, attempt,
      });
      if (!willRetry) break;
      await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * 2 ** (attempt - 1)));
    }
  }
  return { ok: false, error: lastError };
}

export async function executeAnalysis(opts: {
  userId: string;
  repoId: string;
  trigger?: AnalysisTrigger;
  commitSha?: string | null;
  commitMessage?: string | null;
  /** Analyse a specific branch instead of the repo default (e.g. a PR head branch). */
  ref?: string | null;
  /** Re-use an existing analysis row instead of creating a new one (retry path). */
  analysisId?: string;
  /** Restrict the run to a subset of agents (retry path). */
  only?: AgentName[];
}): Promise<{ id: string; summary: string; status: string; agentStatus: Record<string, AgentState> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getRepoTree, getRawFile } = await import("@/lib/github.server");
  const { runDependencyAgent, runDeadCodeAgent, runTestCoverageAgent } = await import("@/lib/agents/agents.server");
  const { embedMany, toVectorLiteral } = await import("@/lib/embeddings.server");
  const { decryptToken } = await import("@/lib/crypto.server");

  const selected = opts.only?.length ? opts.only : AGENTS;

  const { data: repo, error: rErr } = await supabaseAdmin
    .from("repos").select("*").eq("id", opts.repoId).eq("user_id", opts.userId).maybeSingle();
  if (rErr || !repo) throw new Error("Repo not found");

  const { data: tokenRow } = await supabaseAdmin
    .from("github_tokens").select("token_ciphertext").eq("user_id", opts.userId).maybeSingle();
  if (!tokenRow) throw new Error("GitHub not connected");
  const token = decryptToken(tokenRow.token_ciphertext);

  // ── Create or resume the analysis row ──────────────────────────
  let analysisId = opts.analysisId ?? "";
  let runAttempt = 1;
  const agentStatus: Record<string, AgentState> = Object.fromEntries(
    AGENTS.map((a) => [a, selected.includes(a) ? "pending" : "done"]),
  );

  if (analysisId) {
    const { data: prev } = await supabaseAdmin
      .from("analyses").select("attempt, agent_status").eq("id", analysisId).maybeSingle();
    runAttempt = (prev?.attempt ?? 1) + 1;
    const prevStatus = (prev?.agent_status ?? null) as Record<string, AgentState> | null;
    if (prevStatus) for (const a of AGENTS) if (!selected.includes(a)) agentStatus[a] = prevStatus[a] ?? "done";
    await supabaseAdmin.from("analyses").update({
      status: "running", error: null, finished_at: null,
      attempt: runAttempt, agent_status: agentStatus as never,
    }).eq("id", analysisId);
    // Clear the results of the agents we are about to re-run.
    await supabaseAdmin.from("findings").delete().eq("analysis_id", analysisId).in("agent", selected);
    if (selected.includes("test_coverage")) {
      await supabaseAdmin.from("generated_tests").delete().eq("analysis_id", analysisId);
    }
    await supabaseAdmin.from("analysis_chunks").delete().eq("analysis_id", analysisId);
  } else {
    const { data: analysis } = await supabaseAdmin.from("analyses").insert({
      repo_id: repo.id,
      user_id: opts.userId,
      status: "running",
      trigger: opts.trigger ?? "manual",
      commit_sha: opts.commitSha ?? null,
      commit_message: opts.commitMessage ?? null,
      agent_status: agentStatus as never,
    }).select("id").single();
    analysisId = analysis!.id;
  }

  const ctx = { analysisId, userId: opts.userId };
  const runStartedAt = Date.now();
  await logEvent(supabaseAdmin, {
    ...ctx, step: "orchestrator:start", status: "running", attempt: runAttempt,
    message: `${opts.trigger ?? "manual"} run · agents: ${selected.join(", ")}`,
  });

  const persistStatus = async () => {
    await supabaseAdmin.from("analyses").update({ agent_status: agentStatus as never }).eq("id", analysisId);
  };

  try {
    // ── Fetch repo tree (hard dependency for every agent) ────────
    const treeStart = Date.now();
    await logEvent(supabaseAdmin, { ...ctx, step: "fetch:tree", status: "running", attempt: runAttempt });
    const targetBranch = opts.ref || repo.default_branch;
    const tree = await getRepoTree(token, repo.github_full_name, targetBranch);
    await logEvent(supabaseAdmin, {
      ...ctx, step: "fetch:tree", status: "done", durationMs: Date.now() - treeStart,
      message: `${tree.length} files · ${targetBranch}`, attempt: runAttempt,
    });

    const full = repo.github_full_name;
    const branch = targetBranch;

    // ── Fan out agents in parallel, each independently retried ───
    const [depRes, deadRes, covRes] = await Promise.all([
      selected.includes("dependency")
        ? runStep(supabaseAdmin, ctx, "dependency", () => runDependencyAgent(token, full, branch, tree))
        : Promise.resolve({ ok: true as const, value: [] }),
      selected.includes("dead_code")
        ? runStep(supabaseAdmin, ctx, "dead_code", () => runDeadCodeAgent(token, full, branch, tree))
        : Promise.resolve({ ok: true as const, value: [] }),
      selected.includes("test_coverage")
        ? runStep(supabaseAdmin, ctx, "test_coverage", () => runTestCoverageAgent(token, full, branch, tree))
        : Promise.resolve({ ok: true as const, value: { findings: [], tests: [] } }),
    ]);

    if (selected.includes("dependency")) agentStatus.dependency = depRes.ok ? "done" : "failed";
    if (selected.includes("dead_code")) agentStatus.dead_code = deadRes.ok ? "done" : "failed";
    if (selected.includes("test_coverage")) agentStatus.test_coverage = covRes.ok ? "done" : "failed";
    await persistStatus();

    const dep = depRes.ok ? depRes.value : [];
    const dead = deadRes.ok ? deadRes.value : [];
    const cov = covRes.ok ? covRes.value : { findings: [], tests: [] };

    const allFindings = [...dep, ...dead, ...cov.findings];
    if (allFindings.length) {
      await supabaseAdmin.from("findings").insert(allFindings.map((f) => ({
        analysis_id: analysisId, user_id: opts.userId,
        agent: f.agent, severity: f.severity, title: f.title,
        detail: f.detail ?? null, file_path: f.file_path ?? null,
        metadata: (f.metadata ?? null) as never,
      })));
    }
    if (cov.tests.length) {
      await supabaseAdmin.from("generated_tests").insert(cov.tests.map((t) => ({
        analysis_id: analysisId, user_id: opts.userId,
        source_file: t.source_file, target_function: t.target_function ?? null,
        language: t.language, test_code: t.test_code,
      })));
    }
    await logEvent(supabaseAdmin, {
      ...ctx, step: "persist:results", status: "done", attempt: runAttempt,
      message: `${allFindings.length} findings · ${cov.tests.length} tests`,
    });

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
    const SRC_RX = /\.(ts|tsx|js|jsx|py|md)$/;
    const codeFiles = tree
      .filter((f) => SRC_RX.test(f.path) && !/node_modules|dist|build|\.next|__pycache__/.test(f.path))
      .slice(0, 8);
    const raws = await Promise.all(codeFiles.map(async (f) => ({
      path: f.path,
      raw: await getRawFile(token, repo.github_full_name, branch, f.path),
    })));
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
      const embedStart = Date.now();
      try {
        const vecs = await embedMany(chunks.map((c) => c.content));
        await supabaseAdmin.from("analysis_chunks").insert(chunks.map((c, i) => ({
          analysis_id: analysisId, user_id: opts.userId,
          kind: c.kind, source: c.source, content: c.content,
          metadata: (c.metadata ?? null) as never,
          embedding: toVectorLiteral(vecs[i]) as unknown as never,
        })));
        await logEvent(supabaseAdmin, {
          ...ctx, step: "embed:chunks", status: "done", attempt: runAttempt,
          message: `${chunks.length} chunks embedded`, durationMs: Date.now() - embedStart,
        });
      } catch (embErr) {
        console.error("embedding step failed", embErr);
        await logEvent(supabaseAdmin, {
          ...ctx, step: "embed:chunks", status: "failed", attempt: runAttempt,
          message: embErr instanceof Error ? embErr.message : String(embErr),
          durationMs: Date.now() - embedStart,
        });
      }
    }

    const failed = AGENTS.filter((a) => agentStatus[a] === "failed");
    const status = failed.length === selected.length ? "failed" : failed.length ? "partial" : "done";
    const summary = `${dep.length} dep · ${dead.length} dead-code · ${cov.findings.length} coverage · ${cov.tests.length} test(s) generated${
      failed.length ? ` · ${failed.length} agent(s) failed` : ""
    }`;

    await supabaseAdmin.from("analyses").update({
      status, summary, agent_status: agentStatus as never,
      error: failed.length ? `Failed agents: ${failed.join(", ")}` : null,
      finished_at: new Date().toISOString(),
    }).eq("id", analysisId);

    await logEvent(supabaseAdmin, {
      ...ctx, step: "orchestrator:done", status: failed.length ? "failed" : "done",
      message: summary, durationMs: Date.now() - runStartedAt, attempt: runAttempt,
    });

    return { id: analysisId, summary, status, agentStatus };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const a of selected) if (agentStatus[a] !== "done") agentStatus[a] = "failed";
    await supabaseAdmin.from("analyses").update({
      status: "failed", error: msg, agent_status: agentStatus as never,
      finished_at: new Date().toISOString(),
    }).eq("id", analysisId);
    await logEvent(supabaseAdmin, {
      ...ctx, step: "orchestrator:failed", status: "failed", message: msg,
      durationMs: Date.now() - runStartedAt, attempt: runAttempt,
    });
    throw new Error(msg);
  }
}

/** Re-run an existing analysis. By default only the agents that failed. */
export async function retryAnalysis(opts: {
  userId: string; analysisId: string; all?: boolean;
}): Promise<{ id: string; summary: string; status: string; agentStatus: Record<string, AgentState> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: analysis } = await supabaseAdmin
    .from("analyses").select("id, repo_id, agent_status")
    .eq("id", opts.analysisId).eq("user_id", opts.userId).maybeSingle();
  if (!analysis) throw new Error("Analysis not found");

  const prev = (analysis.agent_status ?? null) as Record<string, AgentState> | null;
  const failed = AGENTS.filter((a) => !prev || prev[a] !== "done");
  const only = opts.all || failed.length === 0 ? AGENTS : failed;

  return executeAnalysis({
    userId: opts.userId,
    repoId: analysis.repo_id,
    trigger: "retry",
    analysisId: analysis.id,
    only,
  });
}
