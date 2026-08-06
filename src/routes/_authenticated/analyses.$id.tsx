import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { toast } from "sonner";
import {
  Package, ShieldCheck, TestTube2, MessageSquare, Send, GitPullRequest, ExternalLink,
  RefreshCw, CheckCircle2, XCircle, Loader2, Activity,
} from "lucide-react";
import { getAnalysis, createAnalysisPR, retryAnalysisFn, getJobEvents } from "@/lib/api.functions";



export const Route = createFileRoute("/_authenticated/analyses/$id")({
  head: () => ({
    meta: [
      { title: "Analysis — CodeBuddy" },
      { name: "description", content: "Findings and generated tests from your agents." },
      { property: "og:title", content: "Analysis — CodeBuddy" },
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

const STATE_ICON: Record<string, React.ReactNode> = {
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
  retry: <RefreshCw className="h-3.5 w-3.5 text-warning" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-accent" />,
  failed: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  info: <Activity className="h-3.5 w-3.5 text-muted-foreground" />,
  pending: <Activity className="h-3.5 w-3.5 text-muted-foreground" />,
};

function AnalysisPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["analysis", id],
    queryFn: () => getAnalysis({ data: { id } }),
    refetchInterval: (query) =>
      query.state.data?.analysis?.status === "running" ? 4000 : false,
  });
  const running = q.data?.analysis?.status === "running";
  const events = useQuery({
    queryKey: ["job-events", id],
    queryFn: () => getJobEvents({ data: { analysisId: id } }),
    refetchInterval: running ? 4000 : false,
  });
  const pr = useMutation({
    mutationFn: () => createAnalysisPR({ data: { analysisId: id } }),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`PR #${r.number} opened`, {
        action: { label: "Open", onClick: () => window.open(r.url, "_blank") },
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create PR"),
  });
  const retry = useMutation({
    mutationFn: (all: boolean) => retryAnalysisFn({ data: { analysisId: id, all } }),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`Re-run finished — ${r.status}`);
      qc.invalidateQueries({ queryKey: ["analysis", id] });
      qc.invalidateQueries({ queryKey: ["job-events", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });


  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!q.data?.analysis) return <p>Not found.</p>;
  const { analysis, findings, tests } = q.data;
  const agentStatus = (analysis.agent_status ?? {}) as Record<string, string>;
  const hasFailure = analysis.status === "failed" || analysis.status === "partial";

  const byAgent = findings.reduce<Record<string, typeof findings>>((acc, f) => {
    (acc[f.agent] ||= []).push(f); return acc;
  }, {});

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono text-muted-foreground uppercase">
              Analysis · {analysis.status}{analysis.attempt > 1 ? ` · attempt ${analysis.attempt}` : ""}
            </div>
            <h1 className="text-2xl font-bold mt-1">
              {(analysis as unknown as { repos?: { github_full_name: string } }).repos?.github_full_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{analysis.summary}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => retry.mutate(!hasFailure)} disabled={retry.isPending || running}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50 whitespace-nowrap hover:border-primary/50">
              <RefreshCw className={`h-4 w-4 ${retry.isPending ? "animate-spin" : ""}`} />
              {hasFailure ? "Retry failed agents" : "Re-run"}
            </button>
            <button onClick={() => pr.mutate()} disabled={pr.isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 shadow-lg shadow-primary/20 whitespace-nowrap">
              {pr.isPending ? <>Opening PR…</> : <><GitPullRequest className="h-4 w-4" /> Open PR on GitHub</>}
            </button>
          </div>
        </div>

        {analysis.error && (
          <div className="glass rounded-lg p-3 text-sm border-destructive/50 text-destructive">{analysis.error}</div>
        )}
        {pr.data?.ok === false && (
          <div className="glass rounded-lg p-3 text-sm border-destructive/50 text-destructive">{pr.data.error}</div>
        )}
        {pr.data?.ok && (
          <a href={pr.data.url} target="_blank" rel="noopener"
            className="glass rounded-lg p-3 flex items-center justify-between text-sm hover:border-primary/50">
            <span>PR #{pr.data.number} opened with report, generated tests, and top findings comment.</span>
            <ExternalLink className="h-4 w-4" />
          </a>
        )}

        {/* ── Orchestration: agent pipeline + step timeline ── */}
        <section className="glass rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4" />
            <h2 className="font-semibold">Orchestration</h2>
            {running && <span className="text-xs font-mono text-primary">live</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-3 mb-4">
            {Object.keys(AGENT_META).map((a) => {
              const st = running && !agentStatus[a] ? "running" : (agentStatus[a] ?? "pending");
              return (
                <div key={a} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
                  {STATE_ICON[st] ?? STATE_ICON.pending}
                  <span className="flex-1">{AGENT_META[a].label}</span>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">{st}</span>
                </div>
              );
            })}
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {(events.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No step events recorded for this run.</p>
            )}
            {(events.data ?? []).map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-xs font-mono border-l-2 border-border pl-3 py-1">
                {STATE_ICON[e.status] ?? STATE_ICON.info}
                <span className="text-foreground">{e.step}</span>
                {e.attempt > 1 && <span className="text-warning">#{e.attempt}</span>}
                {e.duration_ms != null && <span className="text-muted-foreground">{e.duration_ms}ms</span>}
                {e.message && <span className="text-muted-foreground flex-1 truncate">{e.message}</span>}
              </div>
            ))}
          </div>
        </section>




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
