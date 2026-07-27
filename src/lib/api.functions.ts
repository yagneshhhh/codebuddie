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
    const { executeAnalysis } = await import("@/lib/analysis.server");
    return executeAnalysis({ userId: context.userId, repoId: data.repoId, trigger: "manual" });
  });

/** Re-run an analysis — failed agents only by default, or everything with `all`. */
export const retryAnalysisFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ analysisId: z.string(), all: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const { retryAnalysis } = await import("@/lib/analysis.server");
      const r = await retryAnalysis({
        userId: context.userId, analysisId: data.analysisId, all: data.all,
      });
      return { ok: true as const, ...r };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Retry failed";
      console.error("retryAnalysis failed", message);
      return { ok: false as const, error: message };
    }
  });

/** Orchestration timeline for one analysis. */
export const getJobEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ analysisId: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: events } = await context.supabase
      .from("job_events")
      .select("id, agent, step, status, message, duration_ms, attempt, created_at")
      .eq("analysis_id", data.analysisId)
      .order("created_at", { ascending: true });
    return events ?? [];
  });

export const listRecentAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("analyses")
      .select("id, status, summary, trigger, commit_sha, commit_message, started_at, finished_at, attempt, agent_status, repos(github_full_name)")
      .order("started_at", { ascending: false })
      .limit(10);
    return data ?? [];
  });


// ── GitHub push webhook configuration ───────────────────────────
export const getWebhookConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ repoId: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: repo } = await context.supabase
      .from("repos")
      .select("id, github_full_name, webhook_enabled, webhook_secret, last_event_at")
      .eq("id", data.repoId)
      .maybeSingle();
    if (!repo) throw new Error("Repo not found");
    return {
      enabled: repo.webhook_enabled,
      secret: repo.webhook_secret,
      lastEventAt: repo.last_event_at,
    };
  });

export const setWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ repoId: z.string(), enabled: z.boolean(), rotate: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: repo } = await context.supabase
      .from("repos").select("id, webhook_secret").eq("id", data.repoId).maybeSingle();
    if (!repo) throw new Error("Repo not found");

    let secret = repo.webhook_secret;
    if (data.enabled && (!secret || data.rotate)) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      secret = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    await supabaseAdmin.from("repos")
      .update({ webhook_enabled: data.enabled, webhook_secret: secret })
      .eq("id", data.repoId);
    return { enabled: data.enabled, secret };
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
    try {
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

    return { ok: true as const, url: pr.html_url, number: pr.number };
    } catch (e) {
      // Surface GitHub permission/API problems as a normal result instead of an
      // unhandled server error (which blanks the page).
      const message = e instanceof Error ? e.message : "Failed to create the pull request.";
      console.error("createAnalysisPR failed", message);
      return { ok: false as const, error: message };
    }
  });

