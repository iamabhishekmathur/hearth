# Hearth

**The open-source AI platform that makes your entire team better, not just one person.**

Every organization has a few AI power users who build incredible workflows. The rest of the team falls behind. The gap widens every week. Hearth closes it — by turning your best people's ceiling into everyone's floor.

---

## The Problem

In every org, a handful of people figure out how to use AI really well. They build great prompts, discover shortcuts, develop workflows that save hours. But none of it spreads. The rest of the team starts from zero, every time. The gap between your best AI users and everyone else keeps growing.

Meanwhile, work piles up in Slack threads, email, and meeting notes — and nobody notices until it's overdue.

## What Hearth Does Differently

### Your AI watches your work, not the other way around

Hearth monitors your team's Slack, email, and meetings. It auto-detects tasks using LLM classification — not keyword matching — and surfaces them on a kanban board before anyone has to think about it. You review, prioritize, and let the agent handle the rest.

### Tasks get done, not just tracked

When a task is approved, Hearth's agent decomposes it into subtasks, executes each one using your connected tools (Jira, GitHub, Google Calendar, etc.), and pauses for human review before marking it done. If something fails, it retries, re-decomposes, or hands off to a human with full context. No task falls through the cracks.

### The team gets smarter together

- **Shared memory** — the AI remembers what your org knows, not just what one person told it. Org-wide, team, and personal memory layers with semantic search.
- **Shared skills** — when someone builds a great workflow, it becomes an installable skill for the whole team.
- **Learning loop** — the agent proposes new skills from patterns it sees in completed work. Skills improve over time, automatically.
- **Collaborative chat** — share sessions with your team. They can view, contribute, or duplicate to continue independently.

### Your org owns its own memory and context

With hosted AI tools, your organization's knowledge lives on someone else's servers — or disappears when you switch providers. Hearth stores all memory, context, skills, and conversation history in your own database. Your institutional knowledge is yours. It compounds over time, and it never gets locked into a vendor.

### Built to stay open

We know the big labs are moving fast. Anthropic, OpenAI, and others will likely ship their own versions of team memory, shared skills, and collaborative AI features — and they'll do it well. Hearth exists because organizations shouldn't have to wait for that, and shouldn't have to depend on a single provider when it arrives. This is the open alternative. MIT licensed, self-hosted, provider-agnostic.

---

## Features

| | |
|---|---|
| **Proactive Work Intake** | LLM-powered task detection from Slack, email, and meetings. Tasks appear on your board automatically. |
| **Agent Kanban** | Full task lifecycle — auto-detected or manual. Agent plans, executes, and asks for review. Sub-agent orchestration for complex work. |
| **Multi-Layer Memory** | Org, team, and personal memory with pgvector semantic search. The AI remembers context across every conversation. |
| **Skills Marketplace** | Install, share, and create reusable AI workflows. The agent proposes new skills from experience. |
| **Collaborative Chat** | Real-time multiplayer sessions. Share with your team, invite collaborators, or publish a link. |
| **Routines** | Scheduled AI workflows — daily standups, weekly reports, recurring analysis — running on your data, on your schedule. |
| **Provider Agnostic** | Anthropic, OpenAI, Ollama, or any OpenAI-compatible endpoint. Switch models per session or per task. |
| **MCP Integrations** | Connect Slack, Gmail, Google Calendar, Jira, GitHub, Notion, and more via Model Context Protocol. |
| **Self-Hosted** | Docker Compose up. Your infrastructure, your data, your keys. Helm charts for Kubernetes. |

---

## Quick Start (Development)

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env        # Add your LLM API key
pnpm install
docker compose up -d         # Postgres + Redis
pnpm dev                     # Start web + API
```

Open `http://localhost:3000`. Configure your LLM provider in Settings, and you're live.

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for Postgres + Redis)

---

## Deployment

### Docker Compose (recommended for most teams)

The fastest way to run Hearth in production. One command brings up the full stack — frontend, API, background worker, Postgres with pgvector, and Redis.

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
```

Create a `.env` file with your production config:

```bash
# Required
ENCRYPTION_KEY=<random-64-char-hex-string>    # openssl rand -hex 32
SESSION_SECRET=<random-string>                 # openssl rand -base64 32

# Add at least one LLM provider
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

Start everything:

```bash
docker compose up -d
```

This runs:
- **Frontend** on port 3000
- **API server** on port 8000
- **Background worker** for task execution, routines, and work intake
- **PostgreSQL 16** with pgvector for data + embeddings
- **Redis 7** for sessions, queues, and real-time pub/sub

Data is persisted in Docker volumes (`pg_data`, `redis_data`, `file_storage`).

### Kubernetes (Helm)

For larger deployments, Helm charts are available in `deploy/helm/`.

```bash
helm install hearth deploy/helm/hearth \
  --set secrets.encryptionKey=<your-key> \
  --set secrets.sessionSecret=<your-secret> \
  --set secrets.databaseUrl=<your-postgres-url>
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_KEY` | Yes | 32-byte hex string for encrypting integration tokens |
| `SESSION_SECRET` | Yes | Random string for signing session cookies |
| `DATABASE_URL` | Yes | PostgreSQL connection string (provided by Docker Compose) |
| `REDIS_URL` | Yes | Redis connection string (provided by Docker Compose) |
| `ANTHROPIC_API_KEY` | One LLM required | Anthropic API key |
| `OPENAI_API_KEY` | One LLM required | OpenAI API key |
| `OLLAMA_BASE_URL` | One LLM required | Ollama endpoint (e.g. `http://localhost:11434`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID for SSO |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |

---

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Frontend   │    │  API Server  │    │    Worker     │
│  React/Vite  │───▶│   Express    │◀──▶│   BullMQ     │
│  Tailwind    │    │  Socket.io   │    │  Consumers   │
└──────────────┘    └──────┬───────┘    └──────┬───────┘
                           │                    │
                    ┌──────┴────────────────────┴──────┐
                    │         PostgreSQL + pgvector      │
                    │              Redis                 │
                    └───────────────────────────────────┘
```

| Layer | Stack |
|---|---|
| Frontend | React, Vite, Tailwind CSS |
| Backend | Node.js, Express, Socket.io |
| Database | PostgreSQL + pgvector (via Prisma) |
| Queue | BullMQ (Redis-backed) |
| Auth | Passport.js (local + OAuth + SSO) |
| Monorepo | Turborepo + pnpm workspaces |

Full-stack TypeScript. One language, one mental model.

---

## Project Structure

```
apps/web/          → React frontend
apps/api/          → Express API + WebSocket server
packages/shared/   → Shared types and utilities
deploy/            → Docker + Helm deployment configs
e2e/               → Playwright end-to-end tests
```

---

## Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start web + API in dev mode
pnpm build            # Build all packages
pnpm test             # Run unit tests
pnpm lint             # ESLint + Prettier check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## Why Not Just Use ChatGPT/Claude?

ChatGPT and Claude are great for one person, one conversation, one task. Hearth is for teams that need:

- **Shared context** — the AI knows what your org knows, not just what you paste in
- **Proactive work detection** — tasks surface from your existing tools, not from you remembering to create them
- **Agent execution** — the AI doesn't just suggest, it does — with human review gates
- **Organizational learning** — skills and memory that compound across your entire team
- **Data ownership** — your memory, context, and knowledge stay in your database, not on a provider's servers
- **No vendor lock-in** — swap LLM providers without losing your org's accumulated knowledge

---

## Roadmap

- [x] Core chat with streaming LLM responses
- [x] Agent kanban with task planning + execution
- [x] Proactive work intake (LLM classification)
- [x] Multi-layer memory with semantic search
- [x] Skills framework with marketplace
- [x] Routines and scheduling engine
- [x] MCP integration layer (Slack, Gmail, Jira, GitHub, etc.)
- [x] Real-time WebSocket updates
- [ ] Collaborative chat sessions (multiplayer)
- [ ] Artifact window (code, documents, tables)
- [ ] Tool invocation in chat (sandbox, web search, file ops)
- [ ] Public leaderboard for AI adoption metrics

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. The short version: PRs welcome, tests required, be kind.

---

## License

MIT — see [LICENSE](LICENSE) for details.
