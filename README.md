


# 🛰️ CodeBuddy — Agentic Codebase Management System

[![Live App](https://img.shields.io/badge/Live-https://codebuddie.netlify.app/-5227FF?style=flat-square)](https://codebuddie.netlify.app/)
[![Stack](https://img.shields.io/badge/Stack-TanStack%20Start%20%2B%20React%2019-3178C6?style=flat-square)](#tech-stack)

**CodeBuddy** is an agentic AI system that connects to your GitHub repository, dispatches a team of specialized AI agents against it, and turns the results into an actionable dashboard — finding **outdated dependencies**, flagging **dead code**, and writing **test coverage** for uncovered functions.

> **Live app:** https://codebuddie.netlify.app/

---

## ✨ Features

### 🔍 Dependency Agent
- Parses `package.json` and `requirements.txt`.
- Checks the live npm / PyPI registries for the latest versions of every dependency.
- Flags outdated packages with current vs. latest versions, severity-rated.

### 🧟 Dead Code Agent
- Pulls JS/TS/Python source files from the repo.
- Uses an AI reviewer to identify unused exports, unreferenced functions, unreachable branches, and commented-out code kept "just in case".
- Only reports high-confidence candidates, so you don't drown in noise.

### 🧪 Test Coverage Agent
- Detects source files with no matching `*.test.*` / `*.spec.*` / `*_test.py` file.
- Generates runnable **Vitest** or **pytest** stubs for the top uncovered functions.
- Copy the generated tests straight from the dashboard.

### 🤖 Autonomous GitHub Actions
- **One-click Pull Request** — CodeBuddy creates a branch (`codebuddy/analysis-<id>`), commits a full markdown analysis report to `.sentinel/`, pushes all generated test files, opens a PR, and posts an autonomous review comment with the critical findings.
- **Webhooks** — push, `pull_request` (opened/reopened/synchronize/ready_for_review), and failed `workflow_run` events automatically trigger a fresh analysis of the affected branch, with HMAC signature verification.

### 📊 Dashboard & Orchestration Timeline
- Repo list, run history, and findings grouped by agent and severity.
- A live job timeline shows every orchestration step (`fetch:tree`, `dependency:start`, `orchestrator:done`, …) with durations and attempt counts.
- Per-agent retries with exponential backoff — one failing agent never blocks the rest. Re-run only the failed agents with a single click.

### 💬 Ask-About-This-Repo Chat
- A conversational panel over each analysis, powered by **pgvector semantic search**.
- Findings, generated tests, and source-code snippets are chunked and embedded during every analysis; chat retrieves the most relevant context via cosine similarity before answering.

### ⚙️ Background Job Queue
- Scans run asynchronously: requests enqueue a job and the dashboard polls for status, so long analyses never time out.
- A worker drains the queue with `FOR UPDATE SKIP LOCKED` job claiming, retry/backoff, and stale-lock recovery.

---

## 🏗️ Architecture

CodeBuddy is built as an **agentic system** organized into layers:

```
                 React Dashboard (TanStack Start + Tailwind + shadcn/ui)
                                   │
                     Typed RPC (TanStack server functions)
                                   │
                     GitHub Webhooks / API  ·  Background Queue
                                   │
                          Orchestrator (Promise.all fan-out)
                                   │
        ┌──────────────────┬──────────────────┬──────────────────┐
        │                  │                  │                  │
   Dependency Agent  Dead Code Agent  Test Coverage Agent   Chat (RAG)
        │                  │                  │                  │
        └──────────────────┴──────────────────┴──────────────────┘
                                   │
                          Tool Execution
           GitHub API │ npm / PyPI registries │ Lovable AI Gateway
                                   │
                 PostgreSQL (Lovable Cloud) + pgvector
```

### The 12 layers, mapped

| Layer | Design | Implementation in CodeBuddy |
| --- | --- | --- |
| **UI** | Dashboard, chat, repo overview, metrics | TanStack Start + React 19 + Tailwind v4 + shadcn/ui + Recharts + `ogl` animated background |
| **API** | Auth, repo registration, chat, webhooks, triggers | TanStack `createServerFn` typed RPC + server routes under `/api` |
| **Orchestration** | Decide which agents run, coordinate results | `executeAnalysis` orchestrator: parallel agent fan-out via `Promise.allSettled`, per-agent retries, partial-success states |
| **Agent** | Many small agents, one responsibility each | 3 specialized agents (`src/lib/agents/`): Dependency, Dead Code, Test Coverage |
| **Model** | Right model for the right task | Lovable AI Gateway — `google/gemini-3-flash-preview` for agents, `google/gemini-embedding-001` for embeddings |
| **State / Memory** | Working, long-term, semantic memory | PostgreSQL (Lovable Cloud): repos, analyses, findings, generated tests, job events |
| **Knowledge (RAG)** | Repo → chunks → embeddings → retrieval | pgvector + `analysis_chunks` table (3072-dim), cosine-similarity retrieval via `match_analysis_chunks` RPC |
| **Infrastructure** | Queue, workers, async execution | `analysis_jobs` table + worker endpoint with `FOR UPDATE SKIP LOCKED` claiming, retries, stale-lock recovery |
| **Event** | Everything starts from an event | GitHub webhooks (push / PR / workflow_run) + manual triggers, recorded as `job_events` |
| **Tool** | Agents use tools | GitHub REST API, npm registry, PyPI, Lovable AI Gateway |
| **Planning** | Plan → execute → observe | Fixed per-agent prompt templates (dynamic ReAct-style planning deferred) |
| **Observability** | Track every agent step | `job_events` audit timeline (agent, event, status, duration, attempts) + server-fn logs |

---

## 🗄️ Data Model

```
profiles(id → auth.users, display_name, created_at)
repos(id, user_id, github_full_name, default_branch, webhook_secret, webhook_enabled, last_event_at, created_at)
analyses(id, repo_id, user_id, status, trigger, ref, commit_sha, commit_message, agent_status, summary, error, started_at, finished_at)
findings(id, analysis_id, agent, severity, title, detail, file_path, line, metadata)
generated_tests(id, analysis_id, source_file, target_function, test_code, language)
job_events(id, analysis_id, agent, event, status, message, attempt, duration_ms, created_at)
analysis_jobs(id, user_id, repo_id, analysis_id, trigger, ref, agents, status, attempts, max_attempts, run_at, locked_at, last_error)
analysis_chunks(id, analysis_id, source, content, embedding vector(3072))
```

- **Row Level Security** on every table — users only see their own repos, analyses, findings, and tests (findings/tests/events scoped via `analysis_id → analyses.user_id`).
- GitHub access tokens are stored **AES-256-GCM encrypted** server-side.
- `job_events` is an append-only audit log — insert is owner-scoped, update/delete revoked.

---

## 🔌 API Surface

| Endpoint | Purpose |
| --- | --- |
| `POST /api/public/github/webhook` | HMAC-verified GitHub webhook → auto-analysis on push / PR / failed CI |
| `GET|POST /api/public/hooks/process-jobs` | Key-protected worker that drains the analysis job queue |
| `/api/chat` | Streaming RAG chat over an analysis |
| `startGithubConnect` / `saveGithubConnection` | GitHub App User Connector authorization flow |
| `listUserRepos` / `addRepo` | Browse and register repositories |
| `runAnalysis` / `retryAnalysis` | Enqueue a full or partial (failed-agents-only) analysis |
| `getAnalysis` / `listAnalyses` / `getJobEvents` | Read analyses and orchestration timelines |
| `createAnalysisPR` | Branch + report + tests + PR + autonomous review comment |

---

## 🛠️ Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | TanStack Start v1 (React 19, Vite, SSR) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Agents / LLM | AI SDK v7 + Lovable AI Gateway (`gemini-3-flash-preview`) |
| Embeddings | `google/gemini-embedding-001` (3072-dim) |
| Database | PostgreSQL (Lovable Cloud) + pgvector |
| Auth | Email/password + Google (Lovable Cloud Auth) |
| GitHub | GitHub REST API via App User Connector |
| Visualization | Recharts + custom `ogl` WebGL gradient background |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+ (use [nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
- npm

### Local development

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

The app runs at `http://localhost:5173`.

### Connecting GitHub
1. Sign up / sign in at the live app.
2. Click **Connect GitHub** and authorize your account (read access to repos; **Contents** and **Pull requests** read/write permissions are needed for autonomous PR generation).
3. Pick a repository and hit **Run analysis**.

> [!NOTE]
> If PR creation returns `403: Resource not accessible by personal access token`, your token is read-only — grant it **Contents: Read and write** and **Pull requests: Read and write**.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

---

## 🗺️ Roadmap

**Shipped**
- ✅ Multi-agent analysis (dependencies, dead code, test coverage)
- ✅ pgvector RAG chat
- ✅ Autonomous PR generation + review comments
- ✅ GitHub webhooks (push / PR / workflow_run)
- ✅ Background job queue with retries
- ✅ Orchestration timeline & observability

**Planned**
- 🔲 ReAct-style dynamic planning loops
- 🔲 Formal AI SDK `tool()` abstractions per agent
- 🔲 Email / Slack notifications
- 🔲 More languages (Go, Rust, Java)
- 🔲 Security & architecture agents (hardcoded secrets, circular deps, SOLID violations)
- 🔲 Multi-model routing (code-heavy tasks on specialized models)

---

## 📄 License

Built with [Lovable](https://lovable.dev). This code is yours — full ownership.

**Live app:** https://codebuddie.lovable.app · **Continue in the editor:** https://lovable.dev/projects/657e01dc-8122-4675-9c0b-90414f0a57d0
