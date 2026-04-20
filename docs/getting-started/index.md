# Getting Started

Get Hearth running locally in under 5 minutes, or set up a full development environment.

[[toc]]

---

## Quickstart (Docker)

The fastest path to a working Hearth instance. Requires only Docker and an LLM API key.

### 1. Clone and configure

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env
```

Open `.env` and add your LLM API key. At minimum, set one of:

```bash
ANTHROPIC_API_KEY=sk-ant-...    # For Claude models
OPENAI_API_KEY=sk-...           # For GPT models
OLLAMA_BASE_URL=http://...      # For local models
```

### 2. Start all services

```bash
docker compose up
```

This starts PostgreSQL (with pgvector), Redis, the API server, the worker, and the web frontend. First run takes a few minutes to build.

### 3. Complete the setup wizard

Open [http://localhost:3000](http://localhost:3000). The setup wizard walks you through:

1. **Create admin account** — set your name, email, password, and organization name.
2. **Connect LLM provider** — select your provider, enter your API key, test the connection, and choose a default model.
3. **Done** — you're redirected to the main app.

### 4. Start your first chat

Click **Chat** in the sidebar. Type a message and press Enter. The AI responds with streaming text, and may generate artifacts (code, documents, diagrams) that appear in the side panel.

---

## Setup Wizard Details

When you visit a fresh Hearth instance for the first time, a setup wizard guides you through initial configuration. It must be completed before the main application is accessible.

### Step 1: Create Admin Account

Provide your **full name**, **email**, **password**, and **organization name**. Hearth creates the organization and your admin user in a single transaction. You're automatically signed in and advanced to the next step.

### Step 2: Connect LLM Provider

Hearth requires at least one language model provider.

| Provider | Models | Notes |
|----------|--------|-------|
| **Anthropic** | Claude Sonnet, Opus, Haiku | Recommended for most teams. API key from [console.anthropic.com](https://console.anthropic.com). |
| **OpenAI** | GPT-4o, o3, o3-mini, o4-mini | API key from [platform.openai.com](https://platform.openai.com). |
| **Ollama** | Llama, Mistral, Qwen | Runs locally — no API key. Provide the server URL (default `http://localhost:11434`). |

**Flow:** Choose provider → enter credentials → click **Test Connection** → select default model → proceed.

**Tips:**
- **Fastest setup:** Anthropic or OpenAI — paste a key and you're ready in seconds.
- **Privacy-first:** Use Ollama. All inference stays on your hardware, no data leaves your network.
- **Cost:** Smaller models (Haiku, o4-mini, Qwen) are significantly cheaper and work well for routines and digests.
- **Multiple providers:** The wizard only requires one. Add more later in **Settings > LLM Config**.

### Step 3: Done

Hearth confirms everything is configured and redirects you to the main application. All wizard settings are accessible from the admin panel afterward.

---

## Development Setup

For local development with hot reloading (not Docker).

### Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| **Node.js** | 20+ | Runtime for API server and build tools |
| **pnpm** | 9+ | Package manager (monorepo workspaces) |
| **Docker** | 24+ | Sandbox containers for agent capabilities |
| **PostgreSQL** | 16+ with pgvector | Primary database with vector search |
| **Redis** | 7+ | Session cache, job queue, WebSocket pub/sub |

#### Installing pgvector

**macOS:** `brew install pgvector`
**Ubuntu/Debian:** `sudo apt install postgresql-16-pgvector`
**Docker:** Included automatically in docker-compose.

### Clone and install

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
pnpm install
```

### Configure environment

```bash
cp .env.example .env
```

At minimum:

```bash
DATABASE_URL="postgresql://hearth:hearth@localhost:5432/hearth"
REDIS_URL="redis://localhost:6379"
SESSION_SECRET="your-session-secret"
ENCRYPTION_KEY="64-hex-character-string"
ANTHROPIC_API_KEY="sk-ant-..."   # or OPENAI_API_KEY or OLLAMA_BASE_URL
```

### Database setup

```bash
createdb hearth
psql hearth -c "CREATE EXTENSION IF NOT EXISTS vector;"
pnpm db:migrate
pnpm db:seed          # optional: sample data
```

### Start dev server

```bash
pnpm dev
```

| Service | URL | Description |
|---|---|---|
| **Frontend** | `http://localhost:3000` | React app (Vite dev server) |
| **API** | `http://localhost:8000` | Express API + WebSocket |
| **Prisma Studio** | `pnpm db:studio` | Visual database browser |

### Common commands

```bash
pnpm dev              # Start web + api in dev mode
pnpm build            # Build all packages
pnpm test             # Run unit tests
pnpm test:coverage    # Run tests with coverage report
pnpm lint             # ESLint + Prettier check
pnpm lint:fix         # Auto-fix lint issues
pnpm db:migrate       # Run Prisma migrations
pnpm db:seed          # Seed sample data
pnpm db:studio        # Open Prisma Studio
```

### Project structure

```
hearth/
  apps/
    web/            React + Vite frontend (port 3000)
    api/            Express API server (port 8000)
  packages/
    shared/         Shared TypeScript types and utilities
  agent-skills/     Skill definitions (SKILL.md files)
  docker/           Sandbox Dockerfiles
  docs/             Documentation site (VitePress)
  e2e/              Playwright end-to-end tests
```

---

## Configuration Reference

Hearth uses environment variables for all configuration, validated at startup with Zod. The API server refuses to start if required variables are missing or malformed.

### Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://hearth:hearth@localhost:5432/hearth` | PostgreSQL connection string. Must have pgvector extension. |

For production, use SSL: `postgresql://hearth:pass@db.example.com:5432/hearth?sslmode=require`

### Redis

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL. Used for sessions, BullMQ, WebSocket pub/sub, and rate limiting. |

### Security

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | Yes | `dev-session-secret` | Secret for signing session cookies. Must be a strong random string in production. |
| `ENCRYPTION_KEY` | Yes | `0000...` (64 zeros) | 256-bit hex key for AES-256-GCM encryption of integration tokens. |

::: danger
The default values for `SESSION_SECRET` and `ENCRYPTION_KEY` are insecure and only suitable for local development. Always generate unique values for production.
:::

**Generating secure keys:**

```bash
openssl rand -base64 32     # Session secret
openssl rand -hex 32        # Encryption key (64 hex chars)
```

### LLM Providers

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | — | API key for Claude models. |
| `OPENAI_API_KEY` | No | — | API key for GPT models. |
| `OLLAMA_BASE_URL` | No | — | Base URL for local Ollama instance. |

At least one provider must be configured.

### OAuth

#### Google

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret. |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:8000/api/v1/auth/oauth/google/callback` | OAuth callback URL. |

Setup: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID → add redirect URI.

#### Slack

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_CLIENT_ID` | No | — | Slack app client ID. |
| `SLACK_CLIENT_SECRET` | No | — | Slack app client secret. |
| `SLACK_SIGNING_SECRET` | No | — | Signing secret for webhook verification. |

Setup: [api.slack.com/apps](https://api.slack.com/apps) → create app → add scopes (`channels:read`, `chat:write`, `users:read`) → install to workspace.

### General

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test`. |
| `API_PORT` | No | `8000` | Express API server port. |
| `API_URL` | No | `http://localhost:8000` | Public API URL. Used for OAuth callbacks and CORS. |
| `WEB_URL` | No | `http://localhost:3000` | Public frontend URL. Used for CORS origin and redirects. |

### Validation

Hearth validates all variables at startup. If validation fails:

```
Invalid environment variables: {
  ENCRYPTION_KEY: ["String must contain exactly 64 character(s)"]
}
```

The server logs specific errors and exits immediately.

### Production Checklist

- [ ] `SESSION_SECRET` is a unique, randomly generated string
- [ ] `ENCRYPTION_KEY` is a unique 64-character hex string
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] `REDIS_URL` uses authentication if exposed to a network
- [ ] `WEB_URL` and `API_URL` point to your production domains
- [ ] `GOOGLE_CALLBACK_URL` is updated for your production domain
- [ ] `NODE_ENV` is set to `production`
- [ ] At least one LLM provider API key is configured
