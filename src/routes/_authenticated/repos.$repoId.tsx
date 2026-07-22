import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, ExternalLink } from "lucide-react";
import { getRepo, runAnalysis } from "@/lib/api.functions";

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
  const q = useQuery({ queryKey: ["repo", repoId], queryFn: () => getRepo({ data: { id: repoId } }) });
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
