import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, GitBranch, ShieldCheck, TestTube2, Package } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CodeBuddy — Agentic Codebase Analyzer" },
      { name: "description", content: "Autonomous AI agents that audit your repositories: outdated dependencies, dead code, and missing test coverage — with generated test stubs." },
      { property: "og:title", content: "CodeBuddy — Agentic Codebase Analyzer" },
      { property: "og:description", content: "Autonomous AI agents that audit your GitHub repos for outdated deps, dead code, and coverage gaps." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="relative min-h-screen">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <nav className="relative flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-2 font-mono text-sm font-bold">
          <div className="h-6 w-6 rounded bg-primary flex items-center justify-center text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          CODEBUDDY
        </div>
        <Link to="/auth" className="rounded-md border border-border bg-card/50 px-4 py-2 text-sm font-medium hover:bg-card">
          Sign in
        </Link>
      </nav>

      <section className="relative mx-auto max-w-5xl px-6 pt-20 pb-24 text-center md:px-12">
        <h1 className="mt-6 text-5xl md:text-7xl font-bold tracking-tight leading-[1.05]">
          Your codebase, <span className="text-gradient">audited by agents.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          CodeBuddy dispatches specialised AI agents against your GitHub repos — flagging outdated dependencies,
          dead code, and untested functions — and drafts the tests you're missing.
        </p>
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <Link to="/auth" className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-110">
            Start analyzing →
          </Link>
          <a href="#agents" className="rounded-md border border-border bg-card/40 px-6 py-3 font-medium hover:bg-card">
            Meet the agents
          </a>
        </div>
      </section>

      <section id="agents" className="relative mx-auto max-w-6xl px-6 pb-24 md:px-12">
        <div className="grid gap-4 md:grid-cols-3">
          <AgentCard icon={<Package className="h-5 w-5" />} name="Dependency Agent"
            desc="Parses package.json / requirements.txt, cross-references npm & PyPI, flags outdated packages." />
          <AgentCard icon={<ShieldCheck className="h-5 w-5" />} name="Dead-Code Agent"
            desc="Reads your source tree, identifies unused exports, unreferenced functions, and stale branches." />
          <AgentCard icon={<TestTube2 className="h-5 w-5" />} name="Test-Coverage Agent"
            desc="Finds files without tests and drafts runnable Vitest/pytest stubs you can commit as-is." />
        </div>

        <div className="mt-16 rounded-2xl border border-border glass p-8">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-widest">
            <GitBranch className="h-3 w-3" /> Orchestration
          </div>
          <p className="mt-3 text-lg">
            One trigger → three agents in parallel → structured findings, ranked by severity, streamed to your dashboard.
            Chat with your analysis to dig deeper.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-lg bg-[color:var(--color-code-bg)] p-4 text-xs text-[color:var(--color-code-fg)]">
{`GitHub Repo
   ↓
[ Orchestrator ]
   ├─▶ Dependency Agent  ─▶ findings
   ├─▶ Dead-Code Agent   ─▶ findings
   └─▶ Coverage Agent    ─▶ findings + generated tests
   ↓
Dashboard  ·  Chat`}
          </pre>
        </div>
      </section>

      <footer className="relative border-t border-border py-8 text-center text-xs font-mono text-muted-foreground">
        CodeBuddy · Built on Lovable
      </footer>
    </div>
  );
}

function AgentCard({ icon, name, desc }: { icon: React.ReactNode; name: string; desc: string }) {
  return (
    <div className="glass rounded-xl p-6 hover:border-primary/40 transition-colors">
      <div className="inline-flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-primary font-mono text-xs">
        {icon} {name}
      </div>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
