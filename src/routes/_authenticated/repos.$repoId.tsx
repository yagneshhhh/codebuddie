import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, ExternalLink, Webhook, Copy, RefreshCw } from "lucide-react";
import { getRepo, runAnalysis, getWebhookConfig, setWebhook } from "@/lib/api.functions";

export const Route = createFileRoute("/_authenticated/repos/$repoId")({
  head: ({ params }) => ({
    meta: [
      { title: `Repository — Sentinel` },
      { name: "description", content: `Analyses for repository ${params.repoId}` },
      { property: "og:title", content: "Repository — Sentinel" },
      { property: "og:description", content: "Repo analysis history" },
    ],
  }),
  component: RepoPage,
});

function RepoPage() {
  const { repoId } = Route.useParams();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo({ data: { id: repoId } }),
    // Poll while a webhook-triggered analysis is still running.
    refetchInterval: (query) =>
      query.state.data?.analyses?.some((a) => a.status === "running") ? 5000 : 15000,
  });
  const run = useMutation({
    mutationFn: () => runAnalysis({ data: { repoId } }),
    onSuccess: (r) => { toast.success("Analysis complete"); navigate({ to: "/analyses/$id", params: { id: r.id } }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!q.data?.repo) return <p>Not found.</p>;
  const { repo, analyses } = q.data;


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-mono text-muted-foreground uppercase">Repository</div>
          <h1 className="text-3xl font-bold font-mono mt-1">{repo.github_full_name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{repo.description || "No description"}</p>
          <a href={`https://github.com/${repo.github_full_name}`} target="_blank" rel="noopener"
             className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
            View on GitHub <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <button onClick={() => run.mutate()} disabled={run.isPending}
          className="flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 shadow-lg shadow-primary/20">
          <Play className="h-4 w-4" />
          {run.isPending ? "Running agents…" : "Run analysis"}
        </button>
      </div>

      {run.isPending && (
        <div className="glass rounded-xl p-6">
          <div className="animate-pulse text-sm text-muted-foreground">
            Dispatching Dependency, Dead-Code, and Test-Coverage agents in parallel. This may take up to a minute.
          </div>
        </div>
      )}

      <WebhookPanel repoId={repoId} fullName={repo.github_full_name} branch={repo.default_branch} />

      <section>
        <h2 className="font-semibold mb-3">History</h2>
        {analyses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No analyses yet — hit "Run analysis" above.</p>
        ) : (
          <div className="space-y-2">
            {analyses.map((a) => (
              <Link key={a.id} to="/analyses/$id" params={{ id: a.id }}
                className="glass rounded-lg p-4 flex justify-between items-center hover:border-primary/50">
                <div>
                  <div className="text-sm">{a.summary || (a.status === "failed" ? "Failed" : "Running…")}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-1">
                    <span className="uppercase mr-2">{(a as { trigger?: string }).trigger === "push" ? "push" : "manual"}</span>
                    {(a as { commit_sha?: string | null }).commit_sha
                      ? <span className="mr-2 text-accent">{(a as { commit_sha?: string | null }).commit_sha!.slice(0, 7)}</span>
                      : null}
                    {new Date(a.started_at).toLocaleString()}
                  </div>
                </div>

                <span className={`text-xs font-mono uppercase px-2 py-1 rounded ${
                  a.status === "done" ? "bg-success/20 text-success"
                    : a.status === "failed" ? "bg-destructive/20 text-destructive"
                    : "bg-warning/20 text-warning"
                }`}>{a.status}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WebhookPanel({ repoId, fullName, branch }: { repoId: string; fullName: string; branch: string }) {
  const cfg = useQuery({ queryKey: ["webhook", repoId], queryFn: () => getWebhookConfig({ data: { repoId } }) });
  const save = useMutation({
    mutationFn: (v: { enabled: boolean; rotate?: boolean }) => setWebhook({ data: { repoId, ...v } }),
    onSuccess: () => { toast.success("Webhook settings saved"); cfg.refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const url = typeof window !== "undefined" ? `${window.location.origin}/api/public/github/webhook` : "";
  const copy = (v: string, label: string) => {
    navigator.clipboard.writeText(v).then(() => toast.success(`${label} copied`));
  };

  return (
    <section className="glass rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4" />
          <h2 className="font-semibold">Auto-analyse on push</h2>
        </div>
        <button
          onClick={() => save.mutate({ enabled: !cfg.data?.enabled })}
          disabled={save.isPending || cfg.isLoading}
          className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
            cfg.data?.enabled ? "bg-card border border-border" : "bg-primary text-primary-foreground"
          }`}>
          {cfg.data?.enabled ? "Disable" : "Enable webhook"}
        </button>
      </div>

      {cfg.data?.enabled ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Add this webhook in GitHub → <span className="font-mono">{fullName}</span> → Settings → Webhooks →
            Add webhook. Content type <span className="font-mono">application/json</span>, event{" "}
            <span className="font-mono">Just the push event</span>. Pushes to{" "}
            <span className="font-mono text-accent">{branch}</span> start an analysis automatically.
          </p>
          <Field label="Payload URL" value={url} onCopy={() => copy(url, "URL")} />
          <Field label="Secret" value={cfg.data.secret ?? ""} mono onCopy={() => copy(cfg.data!.secret ?? "", "Secret")} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Last push received:{" "}
              {cfg.data.lastEventAt ? new Date(cfg.data.lastEventAt).toLocaleString() : "never"}
            </span>
            <button onClick={() => save.mutate({ enabled: true, rotate: true })}
              className="inline-flex items-center gap-1 hover:text-foreground">
              <RefreshCw className="h-3 w-3" /> Rotate secret
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Enable to get a signed webhook endpoint — every push to{" "}
          <span className="font-mono text-accent">{branch}</span> then dispatches the agents automatically.
        </p>
      )}
    </section>
  );
}

function Field({ label, value, mono, onCopy }: { label: string; value: string; mono?: boolean; onCopy: () => void }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex gap-2">
        <input readOnly value={value}
          className={`flex-1 rounded-md bg-input px-3 py-2 text-xs outline-none ${mono ? "font-mono" : ""}`} />
        <button onClick={onCopy} className="rounded-md border border-border px-3 text-muted-foreground hover:text-foreground">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
