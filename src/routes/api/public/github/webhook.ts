import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// GitHub push webhook. External caller → must live under /api/public/*.
// Security: HMAC-SHA256 over the raw body, verified against the per-repo secret.
export const Route = createFileRoute("/api/public/github/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const event = request.headers.get("x-github-event") ?? "";
        const signature = request.headers.get("x-hub-signature-256") ?? "";
        const raw = await request.text();

        if (event === "ping") return Response.json({ ok: true, pong: true });
        if (event !== "push") return Response.json({ ok: true, ignored: event });

        let payload: {
          ref?: string;
          after?: string;
          deleted?: boolean;
          repository?: { full_name?: string; default_branch?: string };
          head_commit?: { message?: string } | null;
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const fullName = payload.repository?.full_name;
        if (!fullName) return new Response("Missing repository", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: repos } = await supabaseAdmin
          .from("repos")
          .select("id, user_id, default_branch, webhook_secret, webhook_enabled")
          .eq("github_full_name", fullName)
          .eq("webhook_enabled", true);

        // Only repos whose secret matches the signature are accepted.
        const matched = (repos ?? []).filter((r) => {
          if (!r.webhook_secret) return false;
          const expected = "sha256=" + createHmac("sha256", r.webhook_secret).update(raw).digest("hex");
          const a = Buffer.from(signature);
          const b = Buffer.from(expected);
          return a.length === b.length && timingSafeEqual(a, b);
        });
        if (matched.length === 0) return new Response("Invalid signature", { status: 401 });

        const branch = (payload.ref ?? "").replace("refs/heads/", "");
        const started: string[] = [];

        for (const repo of matched) {
          await supabaseAdmin.from("repos")
            .update({ last_event_at: new Date().toISOString() })
            .eq("id", repo.id);

          // Only analyse pushes to the tracked default branch, and skip deletions.
          if (payload.deleted || (branch && branch !== repo.default_branch)) continue;

          try {
            const { executeAnalysis } = await import("@/lib/analysis.server");
            const res = await executeAnalysis({
              userId: repo.user_id,
              repoId: repo.id,
              trigger: "push",
              commitSha: payload.after ?? null,
              commitMessage: payload.head_commit?.message ?? null,
            });
            started.push(res.id);
          } catch (e) {
            console.error("webhook analysis failed", fullName, e);
          }
        }

        return Response.json({ ok: true, branch, analyses: started.length });
      },
    },
  },
});
