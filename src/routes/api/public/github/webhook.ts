import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

type Matched = {
  id: string;
  user_id: string;
  default_branch: string;
  webhook_secret: string | null;
  webhook_enabled: boolean | null;
};

/** What to analyse for a given GitHub event, or null to ignore the delivery. */
function planFromEvent(
  event: string,
  payload: Record<string, unknown>,
  repo: Matched,
): { trigger: "push" | "pull_request" | "workflow"; ref: string | null; sha: string | null; message: string | null } | null {
  if (event === "push") {
    const p = payload as {
      ref?: string; after?: string; deleted?: boolean; head_commit?: { message?: string } | null;
    };
    if (p.deleted) return null;
    const branch = (p.ref ?? "").replace("refs/heads/", "");
    if (branch && branch !== repo.default_branch) return null;
    return { trigger: "push", ref: branch || null, sha: p.after ?? null, message: p.head_commit?.message ?? null };
  }

  if (event === "pull_request") {
    const p = payload as {
      action?: string;
      number?: number;
      pull_request?: { title?: string; head?: { ref?: string; sha?: string } };
    };
    if (!["opened", "reopened", "synchronize", "ready_for_review"].includes(p.action ?? "")) return null;
    const head = p.pull_request?.head;
    return {
      trigger: "pull_request",
      ref: head?.ref ?? null,
      sha: head?.sha ?? null,
      message: `PR #${p.number ?? "?"}: ${p.pull_request?.title ?? ""}`.trim(),
    };
  }

  if (event === "workflow_run" || event === "workflow_job") {
    const run = (payload as { workflow_run?: { status?: string; conclusion?: string; name?: string; head_branch?: string; head_sha?: string } }).workflow_run;
    const job = (payload as { workflow_job?: { status?: string; conclusion?: string; workflow_name?: string; head_branch?: string; head_sha?: string } }).workflow_job;
    const w = run ?? job;
    if (!w) return null;
    if (w.status !== "completed") return null;
    // Only re-analyse when CI actually broke — success needs no audit.
    if (w.conclusion !== "failure") return null;
    const name = run?.name ?? job?.workflow_name ?? "workflow";
    return {
      trigger: "workflow",
      ref: w.head_branch ?? null,
      sha: w.head_sha ?? null,
      message: `CI failed: ${name}`,
    };
  }

  return null;
}

// GitHub webhook. External caller → must live under /api/public/*.
// Security: HMAC-SHA256 over the raw body, verified against the per-repo secret.
export const Route = createFileRoute("/api/public/github/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const event = request.headers.get("x-github-event") ?? "";
        const signature = request.headers.get("x-hub-signature-256") ?? "";
        const raw = await request.text();

        if (event === "ping") return Response.json({ ok: true, pong: true });

        const HANDLED = ["push", "pull_request", "workflow_run", "workflow_job"];
        if (!HANDLED.includes(event)) return Response.json({ ok: true, ignored: event });

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const fullName = (payload["repository"] as { full_name?: string } | undefined)?.full_name;
        if (!fullName) return new Response("Missing repository", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: repos } = await supabaseAdmin
          .from("repos")
          .select("id, user_id, default_branch, webhook_secret, webhook_enabled")
          .eq("github_full_name", fullName)
          .eq("webhook_enabled", true);

        // Only repos whose secret matches the signature are accepted.
        const matched = ((repos ?? []) as Matched[]).filter((r) => {
          if (!r.webhook_secret) return false;
          const expected = "sha256=" + createHmac("sha256", r.webhook_secret).update(raw).digest("hex");
          const a = Buffer.from(signature);
          const b = Buffer.from(expected);
          return a.length === b.length && timingSafeEqual(a, b);
        });
        if (matched.length === 0) return new Response("Invalid signature", { status: 401 });

        const started: string[] = [];
        let skipped = 0;

        for (const repo of matched) {
          await supabaseAdmin.from("repos")
            .update({ last_event_at: new Date().toISOString() })
            .eq("id", repo.id);

          const plan = planFromEvent(event, payload, repo);
          if (!plan) { skipped++; continue; }

          try {
            // Queue only — the worker runs the scan out-of-band so GitHub's
            // 10s delivery timeout is never a factor.
            const { enqueueAnalysisJob } = await import("@/lib/queue.server");
            const res = await enqueueAnalysisJob({
              userId: repo.user_id,
              repoId: repo.id,
              trigger: plan.trigger,
              ref: plan.ref,
              commitSha: plan.sha,
              commitMessage: plan.message,
            });
            started.push(res.analysisId);
          } catch (e) {
            console.error("webhook enqueue failed", fullName, event, e);
          }
        }

        return Response.json({ ok: true, event, analyses: started.length, skipped });
      },
    },
  },
});
