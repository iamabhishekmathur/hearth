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

We know the big labs are moving fast. Anthropic, OpenAI, and others will likely ship their own versions of team memory, shared skills, and collaborative AI features — and they'll do it well. Hearth exists because organizations shouldn't have to wait for that, and shouldn't have to depend on a single provider when it arrives. This is the open alternative. AGPL v3 licensed, self-hosted, provider-agnostic.

---

## Features

| | |
|---|---|
| **Proactive Work Intake** | LLM-powered task detection from Slack, email, and meetings. Tasks appear on your board automatically. |
| **Agent Kanban** | Full task lifecycle — auto-detected or manual. Attach links, PDFs, files, images, text blocks, and MCP data as rich context. Agent plans, executes, and asks for review. Sub-agent orchestration for complex work. |
| **Multi-Layer Memory** | Org, team, and personal memory with pgvector semantic search. The AI remembers context across every conversation. |
| **Skills Marketplace** | Install, share, and create reusable AI workflows. The agent proposes new skills from experience. |
| **Collaborative Chat** | Real-time multiplayer sessions. Share with your team, invite collaborators, or publish a link. |
| **Activity Feed** | Real-time social layer — reactions, AI-curated digests, impact metrics, proactive signals, and one-click skill installs. Not just a log, a team intelligence dashboard. |
| **Routines** | Programmable, event-driven, stateful AI workflows. Schedule-based or webhook-triggered. Run-to-run state for delta reports, parameterized templates, approval gates, conditional delivery routing, cross-routine chaining, and org-wide health monitoring. |
| **Provider Agnostic** | Anthropic, OpenAI, Ollama, or any OpenAI-compatible endpoint. Switch models per session or per task. |
| **Compliance Packs** | Automatic detection and scrubbing of sensitive data (PII, PCI, PHI, GDPR, FERPA, financial) before it reaches external LLM providers. Regex + validation-based detectors (Luhn for credit cards, ABA checksums for routing numbers). Transparent round-trip: users see original values, LLMs see placeholders. Per-pack toggles, per-detector overrides, dry-run testing, audit trail, and 30-day stats dashboard. |
| **Governance & Compliance** | Define organizational policies that monitor every chat message. Keyword, regex, or AI-powered semantic rules. Three enforcement modes: monitor (log), warn (notify user), block (prevent message). Violation dashboard, review workflows, trend charts, CSV/JSON export for auditors. System prompt injection makes the AI proactively avoid violations. |
| **Digital Co-Worker** | Cognitive profiles that model how each team member thinks. Extracted automatically from chat conversations. `@mention` anyone in chat to ask "How would Sarah think about this?" — grounded in observed patterns with cited evidence. Off by default, individual opt-out, full audit trail. |
| **Decision Graph** | Organizational decision intelligence — captures what was decided, why, by whom, and what happened after. Auto-detects decisions from chat and meetings, builds patterns from clusters, distills principles, and feeds them back into the agent's context. Timeline explorer, graph view, and admin controls. |
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

Generate your secrets:

```bash
# Generate encryption key (64-char hex string)
openssl rand -hex 32

# Generate session secret
openssl rand -base64 32
```

Create a `.env` file with your production config:

```bash
# Required
ENCRYPTION_KEY=<paste-64-char-hex-string>
SESSION_SECRET=<paste-session-secret>

# Add at least one LLM provider
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
OLLAMA_BASE_URL=http://host.docker.internal:11434
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

To stop:

```bash
docker compose down          # Stop all services (data preserved)
docker compose down -v       # Stop and delete all data
```

To update to a new version:

```bash
git pull
docker compose up -d --build
```

### Kubernetes (Helm)

For larger deployments (500+ users), Helm charts with horizontal pod autoscaling are available in `deploy/helm/`.

**Prerequisites:** Kubernetes 1.25+, Helm 3.x, nginx Ingress Controller, a default StorageClass.

```bash
# Basic install
helm install hearth deploy/helm/hearth \
  --namespace hearth --create-namespace \
  --set secrets.encryptionKey="$(openssl rand -hex 32)" \
  --set secrets.sessionSecret="$(openssl rand -base64 32)" \
  --set ingress.host=hearth.example.com \
  --set env.webUrl=https://hearth.example.com

# Or use a custom values file
helm install hearth deploy/helm/hearth -f my-values.yaml
```

The chart deploys: API (2-10 pods), Worker (1-5 pods), Web frontend, PostgreSQL with pgvector, Redis, and an nginx Ingress routing `/api/` and `/socket.io/` to the API and `/` to the frontend.

**Enable TLS:**

```bash
helm install hearth deploy/helm/hearth \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=hearth-tls \
  --set ingress.host=hearth.example.com
```

**Use external managed databases** (recommended for production):

```bash
helm install hearth deploy/helm/hearth \
  --set postgres.enabled=false \
  --set secrets.databaseUrl="postgresql://user:pass@your-rds-host:5432/hearth" \
  --set redis.enabled=false \
  --set env.redisUrl="redis://your-elasticache-host:6379"
```

**Upgrade:**

```bash
helm upgrade hearth deploy/helm/hearth -f my-values.yaml
```

**Uninstall:**

```bash
helm uninstall hearth
kubectl delete pvc -l app.kubernetes.io/instance=hearth  # Remove persistent data
```

See [`deploy/helm/hearth/README.md`](deploy/helm/hearth/README.md) for the full configuration reference and production checklist.

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

### Production Checklist

- [ ] Generate unique `ENCRYPTION_KEY` and `SESSION_SECRET` (never reuse dev defaults)
- [ ] Enable TLS/HTTPS with a valid certificate
- [ ] Use strong, unique PostgreSQL and Redis passwords
- [ ] Consider external managed databases (RDS, Cloud SQL, ElastiCache) for durability
- [ ] Set up automated backups for PostgreSQL
- [ ] Configure monitoring and alerting (API health: `GET /api/v1/health`)
- [ ] Restrict Docker socket access if sandbox execution is not needed
- [ ] Place behind a reverse proxy or load balancer with rate limiting

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
- [x] Routines engine — stateful, event-driven, composable, with approval gates and chaining
- [x] MCP integration layer (Slack, Gmail, Jira, GitHub, etc.)
- [x] Real-time WebSocket updates
- [x] Activity feed with reactions, AI digests, proactive signals, and impact metrics
- [x] Collaborative chat sessions (multiplayer)
- [x] Artifact window (code, documents, tables)
- [x] Governance logging — policy-based message monitoring with keyword, regex, and AI evaluation; blocking, warning, and monitoring modes; violation dashboard, review workflow, compliance export
- [x] Compliance packs — automatic PII/PCI/PHI/GDPR/FERPA/financial data scrubbing at the LLM provider boundary; regex + validation detectors; transparent scrub/descrub round-trip; per-pack admin controls; audit trail
- [x] Digital co-worker — cognitive profiles extracted from chat conversations; `@mention` to query someone's thinking perspective; evidence-backed responses with cited patterns; org-level toggle (default off); individual opt-out; audit trail
- [x] Context Graph — organizational decision intelligence with automated capture from chat and meeting transcripts, pattern extraction, principle distillation, graph explorer, and 5 agent tools for decision-aware conversations
- [x] Rich Task Context — attach links (auto-fetched), PDFs (text-extracted), files, images (vision-analyzable), text blocks, and MCP integration data to any task card; async extraction pipeline with embedding generation; token-budgeted context serialization into agent prompts; `get_task_context` drill-down tool
- [ ] Tool invocation in chat (sandbox, web search, file ops)
- [ ] Public leaderboard for AI adoption metrics

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. The short version: PRs welcome, tests required, be kind.

---

## License

Hearth is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL v3).

In short: you can use, modify, and self-host Hearth freely, including for commercial purposes. If you modify Hearth and offer it as a network service, you must release your modifications under the same license.

A **commercial license** is available for organizations that need to embed Hearth in proprietary products or cannot accept the AGPL's network-use clause. Contact [abhishek.mathur@tellius.com](mailto:abhishek.mathur@tellius.com) to discuss.
