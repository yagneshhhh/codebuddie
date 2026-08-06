import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { getModel } from "@/lib/ai-gateway.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedOne, toVectorLiteral } from "@/lib/embeddings.server";

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
    if (text) return text;
  }
  return "";
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: UIMessage[]; analysisId?: string };
        if (!Array.isArray(body.messages)) return new Response("messages required", { status: 400 });

        let context = "";
        if (body.analysisId) {
          const { data: analysis } = await supabaseAdmin
            .from("analyses")
            .select("summary, repos(github_full_name)")
            .eq("id", body.analysisId)
            .maybeSingle();
          const repo = (analysis as unknown as { repos?: { github_full_name: string } } | null)?.repos?.github_full_name;

          const query = lastUserText(body.messages);
          let retrieved = "";
          if (query) {
            try {
              const vec = await embedOne(query);
              const { data: matches } = await supabaseAdmin.rpc("match_analysis_chunks", {
                p_analysis_id: body.analysisId,
                p_query_embedding: toVectorLiteral(vec) as unknown as string,
                p_match_count: 6,
              });
              retrieved = ((matches ?? []) as Array<{ kind: string; source: string; content: string; similarity: number }>)
                .map((m) => `— [${m.kind} · ${m.source} · score ${m.similarity.toFixed(2)}]\n${m.content}`)
                .join("\n\n");
            } catch (e) {
              console.error("rag retrieval failed", e);
            }
          }

          context = `Repository: ${repo}\nAnalysis summary: ${analysis?.summary ?? ""}\n\nRelevant retrieved context (top matches for the user's question):\n${retrieved || "(no matches)"}`;
        }

        const result = streamText({
          model: getModel(),
          system: `You are CodeBuddy, an AI code auditor. Answer questions about the analysis using ONLY the retrieved context below when possible. Cite file paths and finding titles. Be concise and actionable. If the context is insufficient, say so.\n\n${context}`,
          messages: await convertToModelMessages(body.messages),
        });
        return result.toUIMessageStreamResponse({ originalMessages: body.messages });
      },
    },
  },
});
