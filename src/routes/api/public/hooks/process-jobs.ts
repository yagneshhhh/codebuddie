import { createFileRoute } from "@tanstack/react-router";

/**
 * Queue worker. Drains pending repository scans so they never run inside a
 * user-facing API request. Called by the scheduler (pg_cron) every minute.
 *
 * Auth: `apikey` header must match the project publishable/anon key.
 */
export const Route = createFileRoute("/api/public/hooks/process-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? "";
        const provided =
          request.headers.get("apikey") ??
          (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let limit = 1;
        try {
          const body = (await request.json()) as { limit?: number } | null;
          if (body?.limit && Number.isFinite(body.limit)) {
            limit = Math.min(Math.max(Math.trunc(body.limit), 1), 5);
          }
        } catch {
          // empty body is fine
        }

        try {
          const { processQueuedJobs } = await import("@/lib/queue.server");
          const result = await processQueuedJobs(limit);
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("queue worker failed", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
