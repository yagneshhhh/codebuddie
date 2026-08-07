import { createFileRoute, Link, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Bot, GitBranch, ShieldCheck, TestTube2, Package } from "lucide-react";

const GradientWaves = lazy(() => import("@/components/GradientWaves"));


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
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <ClientOnly fallback={null}>
          <Suspense fallback={null}>
            <GradientWaves
              horizonColor="#5227FF"
              waveColor="#FF9FFC"
              crestColor="#FFFFFF"
              speed={0.35}
              amplitude={2.5}
              waveScale={0.6}
              waveRatio={0.9}
              swell={35}
              turbulence={20}
              tilt={1.11}
              zoom={1}
              height={5.5}
              fogDepth={15}
              detail="medium"
              brightness={1.1}
              opacity={0.9}
              mouseInteraction
              parallaxStrength={0.5}
              grain
              grainIntensity={0.05}
            />
          </Suspense>
        </ClientOnly>
      </div>
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />

      <nav className="relative flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-2 font-mono text-sm font-bold text-white">
          <div className="h-6 w-6 rounded bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white">
            <Bot className="h-4 w-4" />
          </div>
          CODEBUDDY
        </div>
        <Link to="/auth" className="rounded-md border border-accent/30 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition">
          Sign in
        </Link>
      </nav>

      <section className="relative mx-auto max-w-5xl px-6 pt-20 pb-24 text-center md:px-12">
        <h1 className="mt-6 text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] text-white drop-shadow-[0_2px_20px_oklch(0.82_0.18_350_/_0.35)]">
          Your codebase, <span className="text-gradient">audited by agents.</span>
        </h1>
        <p className="mt-6 text-lg text-white/80 max-w-2xl mx-auto">
          CodeBuddy dispatches specialised AI agents against your GitHub repos — flagging outdated dependencies,
          dead code, and untested functions — and drafts the tests you're missing.
        </p>
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <Link to="/auth" className="rounded-md bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/40 hover:brightness-110 transition">
            Start analyzing →
          </Link>
          <a href="#agents" className="rounded-md border border-accent/30 bg-white/5 px-6 py-3 font-medium text-white hover:bg-white/10 transition">
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

      <footer className="relative border-t border-accent/20 py-8 text-center text-xs font-mono text-white/60">
        CodeBuddy · Built on Lovable
      </footer>
    </div>
  );
}

function AgentCard({ icon, name, desc }: { icon: React.ReactNode; name: string; desc: string }) {
  return (
    <div className="glass rounded-xl p-6 hover:border-accent/40 transition-colors">
      <div className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-primary/20 to-accent/20 px-2 py-1 text-accent font-mono text-xs border border-accent/20">
        {icon} {name}
      </div>
      <p className="mt-4 text-sm text-white/70 leading-relaxed">{desc}</p>
    </div>
  );
}
