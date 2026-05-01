# System Overview

Hearth is a full-stack TypeScript application running as a set of services orchestrated by Docker Compose. This page covers the high-level architecture, technology decisions, and how the components interact.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Compose                           │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Frontend    │    │  API Server  │    │    Worker     │       │
│  │  React/Vite   │───▶│   Express    │◀──▶│   BullMQ     │       │
│  │  Port 3000    │    │  Port 8000   │    │  Consumers   │       │
│  └──────────────┘    └───────┬──────┘    └──────┬───────┘       │
│                              │                   │               │
│              ┌───────────────┴───────────────┐   │               │
│              │                               │   │               │
│  ┌───────────▼──┐    ┌──────────────┐  ┌────▼───▼───┐           │
│  │  PostgreSQL   │    │    Redis     │  │  Sandbox    │           │
│  │  + pgvector   │    │  Cache/Queue │  │  Containers │           │
│  │  Port 5432    │    │  Port 6379   │  │  (dynamic)  │           │
│  └──────────────┘    └──────────────┘  └────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Decisions

Every technology choice optimizes for the fastest path to a working product with community contributions in mind.

| Layer | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (full-stack) | One language, one mental model. Best AI code-generation support. Largest npm ecosystem. |
| **Frontend** | React + Vite + Tailwind CSS | React is the most widely known frontend framework. Vite for fast dev iteration. Tailwind for rapid UI. |
| **Backend** | Node.js + Express | Express is the most ubiquitous Node.js framework. Massive middleware ecosystem. Every contributor has used it. |
| **Real-time** | Socket.io | WebSocket abstraction for agent streaming, task progress, and live notifications. |
| **Database** | PostgreSQL + pgvector | One database for relational data, vector embeddings, and full-text search. Fewer moving parts. |
| **Cache/Queue** | Redis + BullMQ | Session state, pub/sub, and job queue in one service. BullMQ is TypeScript-native. |
| **ORM** | Prisma | Most widely adopted TypeScript ORM. Strong migration tooling and type generation. |
| **Auth** | Passport.js | Universal Node.js auth. Supports local, OAuth, and SAML/OIDC strategies. |
| **Monorepo** | pnpm + Turborepo | Fast installs, strict dependencies, and parallel builds across workspaces. |
| **Containers** | Docker | Agent capability sandboxing and production deployment. |

## System Components

### Frontend (React + Vite)

Single-page application with Tailwind CSS and shadcn/ui components. Primary views:

- **Chat** — Conversational interface with streaming responses
- **Tasks** — Kanban board for task management with sub-agent orchestration
- **Routines** — Scheduled automations (daily briefs, meeting prep, inbox processing)
- **Skills** — Browse, install, and manage agent skills
- **Memory** — View and curate organization, team, and personal memory
- **Settings** — User preferences, integrations, team management, admin controls

Communicates with the API via REST for CRUD operations and WebSocket for real-time updates.

### API Server (Express)

Stateless HTTP server that handles:

- **REST API** — All endpoints prefixed with `/api/v1/`. Zod validation on request bodies. Pino structured logging.
- **WebSocket** — Socket.io server sharing session authentication with Express. Room-based subscriptions for chat sessions and task updates.
- **Authentication** — Passport.js with session cookies (HTTP-only, secure). Supports email/password, Google OAuth, and SAML/OIDC SSO.
- **MCP Gateway** — Routes tool calls to the appropriate connector (Slack, Gmail, Jira, etc.).
- **Agent Runtime** — Orchestrates LLM calls, tool execution, and context assembly for chat and task workflows.

All state lives in PostgreSQL and Redis. The API server can be horizontally scaled behind a load balancer.

### Worker (BullMQ Consumers)

Background job processors running as separate processes. Named queues:

| Queue | Purpose |
|---|---|
| `agent-execution` | Runs agent tasks (the heavy compute — LLM calls, tool execution, sandboxed code) |
| `routine-scheduler` | Triggers scheduled routines (daily briefs, meeting prep) |
| `memory-synthesis` | 24-hour pipeline that distills session insights into long-term memory |
| `work-intake` | Monitors email, Slack, and calendar for inbound tasks |
| `activity-digest` | Generates activity feed summaries for teams |

Workers can be scaled independently. Each instance pulls jobs from the shared Redis-backed queues.

### PostgreSQL + pgvector

Single database for all persistent data:

- **Relational data** — Users, organizations, teams, sessions, tasks, skills, integrations, audit logs
- **Vector embeddings** — Memory entries and decisions stored with 1536-dimensional embeddings for semantic search via pgvector
- **Full-text search** — PostgreSQL's built-in `tsvector` for searching chat messages and memory content

See the [Database guide](./database) for schema details.

### Redis

Ephemeral state layer:

- **Session store** — Express session data for authenticated users
- **Job queues** — BullMQ backing store for all background job queues
- **Pub/sub** — WebSocket event distribution across multiple API server instances
- **Rate limiting** — Request throttling per user/IP

### Sandbox Containers

Dynamically spawned Docker containers for agent capability execution:

- **Code execution** — Run user-provided or agent-generated code in isolation
- **File operations** — Read/write files without access to the host filesystem
- **Web browsing** — Headless browser for research tasks

Each agent task gets an isolated container. Containers are created on demand from pre-built images in `docker/` and destroyed after use. A container pool pre-warms instances for lower latency.

## Data Flow

### Chat Session

```
User types message
  → Frontend sends POST /api/v1/chat/:sessionId/messages
  → API validates, stores message, loads context (memory, identity, skills)
  → Agent runtime calls LLM with assembled prompt
  → LLM streams response tokens
  → API emits tokens via WebSocket to session room
  → If LLM requests tool use → MCP gateway routes to connector → result fed back to LLM
  → Final response stored as assistant message
  → Memory synthesis job queued for later processing
```

### Task Execution

```
Task moves to "executing" status
  → BullMQ job created on agent-execution queue
  → Worker picks up job
  → Agent runtime assembles context (task description, comments, memory, tools)
  → LLM plans and executes steps
  → Each step: tool call → sandbox/connector → result → next step
  → Progress emitted via WebSocket (task:progress event)
  → On completion: output stored, status → "review"
  → On failure: retry with decomposition, or status → "failed" with context
```

### Memory Synthesis

```
Every 24 hours (configurable):
  → Synthesis scheduler creates jobs for each user
  → Worker loads recent sessions and interactions
  → LLM extracts key facts, decisions, and preferences
  → New memory entries created with embeddings
  → Duplicate/contradictory entries reconciled
  → Stale session-scoped memories expired
```
