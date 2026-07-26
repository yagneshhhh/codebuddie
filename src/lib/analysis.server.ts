// Core analysis orchestrator — shared by the manual server function and the
// GitHub push webhook. Runs with the service-role client (no user session).

export type AnalysisTrigger = "manual" | "push";

export async function executeAnalysis(opts: {
  userId: string;
  repoId: string;
  trigger?: AnalysisTrigger;
  commitSha?: string | null;
  commitMessage?: string | null;
}): Promise<{ id: string; summary: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getRepoTree, getRawFile } = await import("@/lib/github.server");
  const { runDependencyAgent, runDeadCodeAgent, runTestCoverageAgent } = await import("@/lib/agents/agents.server");
  const { embedMany, toVectorLiteral } = await import("@/lib/embeddings.server");
  const { decryptToken } = await import("@/lib/crypto.server");

  const { data: repo, error: rErr } = await supabaseAdmin
    .from("repos").select("*").eq("id", opts.repoId).eq("user_id", opts.userId).maybeSingle();
  if (rErr || !repo) throw new Error("Repo not found");

  const { data: tokenRow } = await supabaseAdmin
    .from("github_tokens").select("token_ciphertext").eq("user_id", opts.userId).maybeSingle();
  if (!tokenRow) throw new Error("GitHub not connected");
  const token = decryptToken(tokenRow.token_ciphertext);

  const { data: analysis } = await supabaseAdmin.from("analyses").insert({
    repo_id: repo.id,
    user_id: opts.userId,
    status: "running",
    trigger: opts.trigger ?? "manual",
    commit_sha: opts.commitSha ?? null,
    commit_message: opts.commitMessage ?? null,
  }).select("id").single();
  const analysisId = analysis!.id;

  try {
    const tree = await getRepoTree(token, repo.github_full_name, repo.default_branch);

    const [dep, dead, cov] = await Promise.all([
      runDependencyAgent(token, repo.github_full_name, repo.default_branch, tree),
      runDeadCodeAgent(token, repo.github_full_name, repo.default_branch, tree),
      runTestCoverageAgent(token, repo.github_full_name, repo.default_branch, tree),
    ]);

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
      raw: await getRawFile(token, repo.github_full_name, repo.default_branch, f.path),
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
      try {
        const vecs = await embedMany(chunks.map((c) => c.content));
        await supabaseAdmin.from("analysis_chunks").insert(chunks.map((c, i) => ({
          analysis_id: analysisId, user_id: opts.userId,
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
}
