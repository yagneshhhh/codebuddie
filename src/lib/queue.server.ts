// Background job queue for repository scans.
//
// Scans take minutes — far longer than a safe HTTP request — so the API only
// *enqueues* a job (and a `queued` analysis row the UI can already show), and a
// worker drains the queue out-of-band (cron ping or manual worker call).

import type { AgentName, AnalysisTrigger } from "@/lib/analysis.server";

const BASE_BACKOFF_SEC = 30;

export type EnqueueArgs = {
  userId: string;
  repoId: string;
  trigger?: AnalysisTrigger;
  ref?: string | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  agents?: AgentName[];
};

/** Create the queued analysis row + its job. Returns immediately. */
export async function enqueueAnalysisJob(args: EnqueueArgs): Promise<{ jobId: string; analysisId: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: repo } = await supabaseAdmin
    .from("repos").select("id").eq("id", args.repoId).eq("user_id", args.userId).maybeSingle();
  if (!repo) throw new Error("Repo not found");

  const { data: analysis, error: aErr } = await supabaseAdmin.from("analyses").insert({
    repo_id: args.repoId,
    user_id: args.userId,
    status: "queued",
    trigger: args.trigger ?? "manual",
    commit_sha: args.commitSha ?? null,
    commit_message: args.commitMessage ?? null,
  }).select("id").single();
  if (aErr || !analysis) throw new Error(aErr?.message ?? "Could not queue analysis");

  const { data: job, error: jErr } = await supabaseAdmin.from("analysis_jobs").insert({
    user_id: args.userId,
    repo_id: args.repoId,
    analysis_id: analysis.id,
    trigger: args.trigger ?? "manual",
    ref: args.ref ?? null,
    commit_sha: args.commitSha ?? null,
    commit_message: args.commitMessage ?? null,
    agents: args.agents ?? null,
  }).select("id").single();
  if (jErr || !job) throw new Error(jErr?.message ?? "Could not queue job");

  await supabaseAdmin.from("job_events").insert({
    analysis_id: analysis.id,
    user_id: args.userId,
    step: "queue:enqueued",
    status: "info",
    message: `${args.trigger ?? "manual"} scan queued`,
  });

  return { jobId: job.id, analysisId: analysis.id };
}

/**
 * Claim up to `limit` pending jobs and run them.
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so concurrent workers never double-run a job.
 */
export async function processQueuedJobs(limit = 1): Promise<{
  processed: number;
  results: { jobId: string; analysisId: string | null; status: string; error?: string }[];
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { executeAnalysis } = await import("@/lib/analysis.server");

  const { data: jobs, error } = await supabaseAdmin.rpc("claim_analysis_jobs", { p_limit: limit });
  if (error) throw new Error(error.message);

  const results: { jobId: string; analysisId: string | null; status: string; error?: string }[] = [];

  for (const job of jobs ?? []) {
    try {
      const res = await executeAnalysis({
        userId: job.user_id,
        repoId: job.repo_id,
        trigger: (job.trigger as AnalysisTrigger) ?? "manual",
        ref: job.ref,
        commitSha: job.commit_sha,
        commitMessage: job.commit_message,
        attachAnalysisId: job.analysis_id ?? undefined,
        only: (job.agents as AgentName[] | null) ?? undefined,
      });
      await supabaseAdmin.from("analysis_jobs").update({
        status: "done", last_error: null, updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      results.push({ jobId: job.id, analysisId: res.id, status: "done" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const canRetry = job.attempts < job.max_attempts;
      const runAt = new Date(Date.now() + BASE_BACKOFF_SEC * 1000 * 2 ** (job.attempts - 1));
      await supabaseAdmin.from("analysis_jobs").update({
        status: canRetry ? "queued" : "failed",
        last_error: message,
        run_at: canRetry ? runAt.toISOString() : job.run_at,
        locked_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      if (job.analysis_id) {
        await supabaseAdmin.from("analyses").update({
          status: canRetry ? "queued" : "failed",
          error: message,
          finished_at: canRetry ? null : new Date().toISOString(),
        }).eq("id", job.analysis_id);
        await supabaseAdmin.from("job_events").insert({
          analysis_id: job.analysis_id,
          user_id: job.user_id,
          step: canRetry ? "queue:retry" : "queue:failed",
          status: canRetry ? "retry" : "failed",
          message,
          attempt: job.attempts,
        });
      }
      results.push({ jobId: job.id, analysisId: job.analysis_id, status: canRetry ? "queued" : "failed", error: message });
    }
  }

  return { processed: results.length, results };
}
