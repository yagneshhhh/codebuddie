import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { toast } from "sonner";
import { Package, ShieldCheck, TestTube2, MessageSquare, Send, GitPullRequest, ExternalLink } from "lucide-react";
import { getAnalysis, createAnalysisPR } from "@/lib/api.functions";


export const Route = createFileRoute("/_authenticated/analyses/$id")({
  head: () => ({
    meta: [
      { title: "Analysis — Sentinel" },
      { name: "description", content: "Findings and generated tests from your agents." },
      { property: "og:title", content: "Analysis — Sentinel" },
      { property: "og:description", content: "Agent findings and tests." },
    ],
  }),
  component: AnalysisPage,
});

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-destructive/20 text-destructive",
  high: "bg-destructive/20 text-destructive",
  medium: "bg-warning/20 text-warning",
  low: "bg-accent/20 text-accent",
  info: "bg-muted text-muted-foreground",
};
const AGENT_META: Record<string, { icon: React.ReactNode; label: string }> = {
  dependency: { icon: <Package className="h-4 w-4" />, label: "Dependency" },
  dead_code: { icon: <ShieldCheck className="h-4 w-4" />, label: "Dead Code" },
  test_coverage: { icon: <TestTube2 className="h-4 w-4" />, label: "Test Coverage" },
};

function AnalysisPage() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["analysis", id], queryFn: () => getAnalysis({ data: { id } }) });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!q.data?.analysis) return <p>Not found.</p>;
  const { analysis, findings, tests } = q.data;

  const byAgent = findings.reduce<Record<string, typeof findings>>((acc, f) => {
    (acc[f.agent] ||= []).push(f); return acc;
  }, {});

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div>
          <div className="text-xs font-mono text-muted-foreground uppercase">Analysis</div>
          <h1 className="text-2xl font-bold mt-1">
            {(analysis as unknown as { repos?: { github_full_name: string } }).repos?.github_full_name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{analysis.summary}</p>
        </div>

        {Object.entries(byAgent).map(([agent, list]) => (
          <section key={agent} className="glass rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              {AGENT_META[agent]?.icon}
              <h2 className="font-semibold">{AGENT_META[agent]?.label || agent}</h2>
              <span className="text-xs font-mono text-muted-foreground">{list.length}</span>
            </div>
            <div className="space-y-2">
              {list.map((f) => (
                <div key={f.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{f.title}</div>
                      {f.detail && <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap font-mono">{f.detail}</pre>}
                      {f.file_path && <div className="mt-2 text-xs font-mono text-accent">{f.file_path}</div>}
                    </div>
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${SEVERITY_COLORS[f.severity]}`}>
                      {f.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {tests.length > 0 && (
          <section className="glass rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <TestTube2 className="h-4 w-4" />
              <h2 className="font-semibold">Generated tests</h2>
              <span className="text-xs font-mono text-muted-foreground">{tests.length}</span>
            </div>
            <div className="space-y-4">
              {tests.map((t) => (
                <div key={t.id}>
                  <div className="text-xs font-mono text-accent mb-2">{t.source_file} · {t.language}</div>
                  <pre className="overflow-x-auto rounded-lg bg-[color:var(--color-code-bg)] p-4 text-xs text-[color:var(--color-code-fg)]">
{t.test_code}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <ChatPanel analysisId={id} />
    </div>
  );
}

function ChatPanel({ analysisId }: { analysisId: string }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    id: analysisId,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { analysisId } }),
  });
  const busy = status === "submitted" || status === "streaming";
  return (
    <aside className="glass rounded-xl p-4 flex flex-col h-[calc(100vh-8rem)] sticky top-24">
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border">
        <MessageSquare className="h-4 w-4" /> <span className="font-semibold text-sm">Ask about this analysis</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 text-sm">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ask about findings, request explanations, or how to fix specific issues.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={`rounded-lg px-3 py-2 max-w-[85%] ${
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border"
            }`}>
              {m.parts.map((p, i) => p.type === "text" ? <span key={i}>{p.text}</span> : null)}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput("");
        }}
        className="mt-3 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary" />
        <button type="submit" disabled={busy || !input.trim()}
          className="rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </aside>
  );
}
