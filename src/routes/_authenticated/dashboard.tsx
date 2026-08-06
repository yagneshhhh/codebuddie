import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Github, Plus, Trash2, FolderGit2, Activity } from "lucide-react";
import {
  getGithubStatus, saveGithubToken, disconnectGithub,
  listMyGithubRepos, addRepo, listRepos, listRecentAnalyses,
} from "@/lib/api.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Sentinel" },
      { name: "description", content: "Your connected repositories and recent analyses." },
      { property: "og:title", content: "Dashboard — Sentinel" },
      { property: "og:description", content: "Manage repos and analyses." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const router = useRouter();
  const status = useQuery({ queryKey: ["gh-status"], queryFn: () => getGithubStatus() });
  const myRepos = useQuery({ queryKey: ["repos"], queryFn: () => listRepos() });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Connect GitHub, add repos, dispatch agents.</p>
      </div>

      <section className="glass rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Github className="h-4 w-4" /> <h2 className="font-semibold">GitHub connection</h2>
        </div>
        {status.isLoading ? <p className="text-sm text-muted-foreground">…</p>
          : status.data?.connected
            ? <ConnectedPanel login={status.data.login!} onChange={() => { status.refetch(); }} />
            : <ConnectForm onDone={() => status.refetch()} />}
      </section>

      {status.data?.connected && (
        <section className="glass rounded-xl p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Plus className="h-4 w-4" /> Add a repository</h2>
          <AddRepoPicker onAdded={() => { myRepos.refetch(); router.invalidate(); }} />
        </section>
      )}

      <JobStatus />

      <section>
        <h2 className="font-semibold mb-4 flex items-center gap-2"><FolderGit2 className="h-4 w-4" /> Your repositories</h2>
        {myRepos.data && myRepos.data.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {myRepos.data.map((r) => (
              <Link key={r.id} to="/repos/$repoId" params={{ repoId: r.id }}
                className="glass rounded-lg p-4 hover:border-primary/50 transition-colors block">
                <div className="font-mono text-sm font-semibold">{r.github_full_name}</div>
                <div className="text-xs text-muted-foreground mt-1">{r.description || "No description"}</div>
                <div className="mt-2 flex gap-2 text-[10px] font-mono uppercase text-muted-foreground">
                  <span>{r.language || "—"}</span>·<span>{r.default_branch}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No repositories added yet.</p>
        )}
      </section>
    </div>
  );
}

function JobStatus() {
  const q = useQuery({
    queryKey: ["recent-analyses"],
    queryFn: () => listRecentAnalyses(),
    // Poll faster while something is still running (e.g. a push-triggered job).
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === "running") ? 5000 : 20000,
  });
  const rows = q.data ?? [];
  return (
    <section>
      <h2 className="font-semibold mb-4 flex items-center gap-2"><Activity className="h-4 w-4" /> Job status</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No analysis jobs yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <Link key={a.id} to="/analyses/$id" params={{ id: a.id }}
              className="glass rounded-lg p-3 flex items-center justify-between gap-3 hover:border-primary/50">
              <div className="min-w-0">
                <div className="font-mono text-sm truncate">
                  {(a as unknown as { repos?: { github_full_name: string } }).repos?.github_full_name}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {a.summary || (a.status === "failed" ? "Failed" : "Agents running…")}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {a.trigger === "pull_request" ? "PR" : a.trigger === "workflow" ? "CI" : a.trigger === "push" ? "push" : a.trigger === "retry" ? "retry" : "manual"}
                </span>
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
                  a.status === "done" ? "bg-success/20 text-success"
                    : a.status === "failed" ? "bg-destructive/20 text-destructive"
                    : "bg-warning/20 text-warning animate-pulse"
                }`}>{a.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const m = useMutation({
    mutationFn: (t: string) => saveGithubToken({ data: { token: t } }),
    onSuccess: (r) => { toast.success(`Connected as ${r.login}`); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Paste a GitHub Personal Access Token (classic or fine-grained) with <code className="font-mono text-xs bg-code-bg px-1 py-0.5 rounded">repo</code> read scope.
        Stored encrypted, never exposed to the browser.
      </p>
      <a href="https://github.com/settings/tokens/new?scopes=repo&description=Sentinel" target="_blank" rel="noopener"
         className="text-xs text-primary underline">Generate a token →</a>
      <div className="flex gap-2">
        <input type="password" placeholder="ghp_…" value={token} onChange={(e) => setToken(e.target.value)}
          className="flex-1 rounded-md bg-input px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary" />
        <button onClick={() => m.mutate(token)} disabled={!token || m.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          Connect
        </button>
      </div>
    </div>
  );
}

function ConnectedPanel({ login, onChange }: { login: string; onChange: () => void }) {
  const m = useMutation({
    mutationFn: () => disconnectGithub(),
    onSuccess: () => { toast.success("Disconnected"); onChange(); },
  });
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm">Connected as <span className="font-mono font-semibold text-primary">@{login}</span></div>
      <button onClick={() => m.mutate()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" /> Disconnect
      </button>
    </div>
  );
}

function AddRepoPicker({ onAdded }: { onAdded: () => void }) {
  const q = useQuery({ queryKey: ["gh-repos"], queryFn: () => listMyGithubRepos() });
  const m = useMutation({
    mutationFn: (r: { full_name: string; default_branch: string; description: string | null; language: string | null }) =>
      addRepo({ data: r }),
    onSuccess: () => { toast.success("Repo added"); onAdded(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading your GitHub repos…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  return (
    <div className="max-h-72 overflow-y-auto space-y-1">
      {q.data?.map((r) => (
        <button key={r.full_name} onClick={() => m.mutate(r)}
          className="w-full text-left flex justify-between items-center rounded px-3 py-2 hover:bg-card">
          <span className="font-mono text-sm">{r.full_name}</span>
          <span className="text-xs text-muted-foreground">{r.language || ""}</span>
        </button>
      ))}
    </div>
  );
}
