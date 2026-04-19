# Installation

This guide walks you through setting up Hearth for local development. For production deployment with Docker Compose, see the [Docker guide](/self-hosting/docker).

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| **Node.js** | 20+ | Runtime for API server and build tools |
| **pnpm** | 9+ | Package manager (monorepo workspaces) |
| **Docker** | 24+ | Sandbox containers for agent capabilities |
| **PostgreSQL** | 16+ with pgvector | Primary database with vector search |
| **Redis** | 7+ | Session cache, job queue, WebSocket pub/sub |

### Installing pgvector

pgvector is a PostgreSQL extension for vector similarity search. Hearth uses it to store and query embeddings for the memory system.

**macOS (Homebrew):**
```bash
brew install pgvector
```

**Ubuntu/Debian:**
```bash
sudo apt install postgresql-16-pgvector
```

**Docker (included automatically):**
The `docker-compose.yml` uses a PostgreSQL image with pgvector pre-installed.

## Clone and Install

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
pnpm install
```

This installs dependencies for all workspaces: `apps/web`, `apps/api`, `packages/shared`, and `docs`.

## Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

At minimum, you need:

```bash
# Database
DATABASE_URL="postgresql://hearth:hearth@localhost:5432/hearth"

# Redis
REDIS_URL="redis://localhost:6379"

# Security (generate real values for production)
SESSION_SECRET="your-session-secret"
ENCRYPTION_KEY="64-hex-character-string"

# At least one LLM provider
ANTHROPIC_API_KEY="sk-ant-..."
# or
OPENAI_API_KEY="sk-..."
```

See the [Configuration reference](./configuration) for all available environment variables.

## Database Setup

Create the database and run migrations:

```bash
# Create the database (if it doesn't exist)
createdb hearth

# Enable pgvector extension
psql hearth -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Run Prisma migrations
pnpm db:migrate
```

Optionally seed the database with sample data:

```bash
pnpm db:seed
```

## Start the Dev Server

```bash
pnpm dev
```

This starts both the frontend and API server in development mode with hot reloading:

| Service | URL | Description |
|---|---|---|
| **Frontend** | `http://localhost:3000` | React app (Vite dev server) |
| **API** | `http://localhost:8000` | Express API + WebSocket |
| **Prisma Studio** | Run `pnpm db:studio` | Visual database browser |

## First Run Walkthrough

1. **Open the app** at `http://localhost:3000`
2. **Create an account** using email/password or Google OAuth (if configured)
3. **Create your organization** — choose a name and invite your team
4. **Connect an integration** — start with Slack or Gmail under Settings > Integrations
5. **Start a chat session** — ask the agent to summarize your recent emails or create a task
6. **Explore the kanban board** — tasks auto-detected from your integrations appear here

## Project Structure

```
hearth/
  apps/
    web/            React + Vite frontend (port 3000)
    api/            Express API server (port 8000)
  packages/
    shared/         Shared TypeScript types and utilities
  agent-skills/     Skill definitions (SKILL.md files)
  docker/           Sandbox Dockerfiles
  docs/             This documentation site (VitePress)
  e2e/              Playwright end-to-end tests
```

## Common Commands

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
pnpm docs:dev         # Start docs dev server
```

## Next Steps

- [Configuration reference](./configuration) — all environment variables
- [Docker deployment](/self-hosting/docker) — production setup with Docker Compose
- [Architecture overview](/developers/architecture/) — how the system works
- [User Guide](/guide/) — learn all Hearth features
