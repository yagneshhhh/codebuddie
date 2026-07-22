## Codebase Management System — MVP (TS-native)

A Lovable-hosted agentic system that connects to a user's GitHub repo, runs three specialized AI agents against it, and shows results in a dashboard.

### Scope (MVP)
1. Auth (email/password + Google) with user-scoped repos & analyses.
2. Connect GitHub via **App User Connector** (each user authorizes their own account).
3. Pick a repo → run an analysis job (orchestrator dispatches 3 agents in parallel):
   - **Dependency Agent** — parses `package.json` / `requirements.txt`, checks npm/PyPI registries for latest versions, flags outdated + known-vulnerable.
   - **Dead Code Agent** — pulls JS/TS source, uses AI + simple export/import graph heuristics to flag unreferenced exports and unused functions.
   - **Test Coverage Agent** — finds source files with no matching test file, asks AI to generate Vitest/Jest test stubs for the top uncovered functions.
4. Dashboard shows: repos, analyses, findings (grouped by agent, severity), AI-generated test snippets (copyable).
5. Simple chat panel — "Ask about this repo" — RAG-lite over the last analysis's findings (no vector DB in MVP; direct context injection).

### Architecture mapping (your 12 layers → MVP)
- **UI**: TanStack Start + Tailwind + shadcn (already in project).
- **API**: TanStack `createServerFn` (typed RPC) — no separate FastAPI.
- **Orchestration**: single `runAnalysis` server fn that fans out to agent functions (LangGraph replacement — AI SDK `generateText` per agent, `Promise.all`).
- **Agents**: 3 modules under `src/lib/agents/*.functions.ts`.
- **Model**: Lovable AI Gateway, `google/gemini-3-flash-preview` (fast, cheap) for all agents.
- **State/Memory**: Lovable Cloud (Supabase) — tables `repos`, `analyses`, `findings`, `generated_tests`.
- **Knowledge/RAG**: MVP = fetch relevant files on demand from GitHub API + include in prompt. pgvector deferred.
- **Infra/Execution**: Cloudflare Workers (TanStack Start default). No RabbitMQ/Celery — server fns run inline; long jobs marked `status: running` and polled.
- **Events**: manual "Run analysis" button in MVP; GitHub webhooks deferred.
- **Tools**: GitHub API (via connector gateway), npm/PyPI registry (public fetch).
- **Planning**: each agent has a fixed prompt template — ReAct loops deferred.
- **Observability**: server-fn logs + a `job_events` table for step tracking.

### Data model
```
profiles(id → auth.users, display_name, created_at)
repos(id, user_id, github_full_name, default_branch, created_at)
analyses(id, repo_id, user_id, status, started_at, finished_at, summary)
findings(id, analysis_id, agent, severity, title, detail, file_path, line)
generated_tests(id, analysis_id, source_file, target_function, test_code, language)
job_events(id, analysis_id, agent, event, message, created_at)
```
RLS on all — `user_id = auth.uid()`; findings/tests/events scoped via `analysis_id → analyses.user_id`.

### Routes
```
/                       marketing landing + Sign in CTA
/auth                   login / signup (email + Google)
/_authenticated/dashboard      repo list, "Connect GitHub", "Add repo"
/_authenticated/repos/$repoId  repo detail + "Run analysis" button, past analyses
/_authenticated/analyses/$id   findings by agent + chat panel
/oauth/github/return           App User Connector redirect landing
/api/public/github/webhook     (stub for future; not wired in MVP)
```

### Server functions
- `startGithubConnect`, `saveGithubConnection`, `disconnectGithub`
- `listUserRepos` (GitHub `/user/repos`)
- `addRepo({ full_name })`
- `runAnalysis({ repoId })` — creates `analyses` row, calls the 3 agents in parallel, writes findings
- `getAnalysis({ id })`, `listAnalyses({ repoId })`
- `chatAboutAnalysis({ analysisId, message })` — streams via `/api/chat`

### Design system
Dark, technical, "code-cockpit" feel — deep navy background, mono accents for code snippets, subtle severity colors (amber/red/emerald). Inter body + JetBrains Mono for code. All tokens in `src/styles.css`.

### Explicitly deferred (post-MVP)
GitHub webhooks, pgvector RAG, Redis/queues, LangGraph, Slack/Jira tools, multi-model routing, Langfuse observability, autonomous PR comments.

### Build order this turn
1. Enable Lovable Cloud + configure email/Google auth.
2. Migrations (tables + RLS + grants + profile trigger).
3. GitHub App User Connector wiring (server + client + connection storage table).
4. Design system + landing + auth pages + `_authenticated` layout.
5. Dashboard, repo detail, analysis detail pages.
6. Three agent server fns + orchestrator + chat route.
7. SEO heads, sitemap, robots.

### Follow-up questions I still need
1. **GitHub scope** — read private repos too, or public only? (Private = `repo` scope, more sensitive.)
2. **Languages** — JS/TS + Python for MVP, or JS/TS only? (Fewer languages = tighter MVP.)
3. **Analysis trigger** — manual button only for MVP (deferring webhooks) OK?
4. **Design vibe** — the "code-cockpit" dark-navy direction OK, or want me to show a couple of options first?
