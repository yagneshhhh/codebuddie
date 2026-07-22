import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { getModel } from "@/lib/ai-gateway.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: UIMessage[]; analysisId?: string };
        if (!Array.isArray(body.messages)) return new Response("messages required", { status: 400 });

        let context = "";
        if (body.analysisId) {
          const [{ data: analysis }, { data: findings }] = await Promise.all([
            supabaseAdmin.from("analyses").select("summary, repos(github_full_name)").eq("id", body.analysisId).maybeSingle(),
            supabaseAdmin.from("findings").select("agent, severity, title, detail, file_path").eq("analysis_id", body.analysisId),
          ]);
          const repo = (analysis as unknown as { repos?: { github_full_name: string } } | null)?.repos?.github_full_name;
          context = `Repository: ${repo}\nSummary: ${analysis?.summary}\n\nFindings:\n` +
            (findings ?? []).map((f) =>
              `- [${f.agent}/${f.severity}] ${f.title}${f.file_path ? ` (${f.file_path})` : ""}${f.detail ? `\n  ${f.detail.slice(0, 300)}` : ""}`
            ).join("\n");
        }

        const result = streamText({
          model: getModel(),
          system: `You are Sentinel, an AI code auditor. Answer questions about the following analysis with concrete, actionable advice. Be concise.\n\n${context}`,
          messages: await convertToModelMessages(body.messages),
        });
        return result.toUIMessageStreamResponse({ originalMessages: body.messages });
      },
    },
  },
});
