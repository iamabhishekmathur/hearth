# Docker Compose Deployment

Deploy Hearth on a single server using Docker Compose. This is the simplest self-hosting option — ideal for small teams, internal deployments, and evaluation before scaling to Kubernetes.

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- At least 4 GB RAM and 2 CPU cores
- A clone of the Hearth repository
- At least one LLM API key (Anthropic, OpenAI, or a local Ollama instance)

## Getting Started

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env
# Edit .env — add at least one LLM API key
```

Review the `.env` file and set your secrets before starting. See the [Production Checklist](./production) for guidance on generating secure values for `ENCRYPTION_KEY`, `SESSION_SECRET`, and database passwords.

```bash
docker compose up
```

The first build takes a few minutes to install dependencies and compile TypeScript. Subsequent starts are fast thanks to Docker layer caching.

Once running, open `http://localhost:3000` in your browser.

## Service Overview

| Service | Image | Port | Description |
|---|---|---|---|
| **web** | Built from `apps/web/` | 3000 | React frontend served by Vite (dev) or nginx (production) |
| **api** | Built from `apps/api/` | 8000 | Express API server with WebSocket support |
| **worker** | Built from `apps/api/` | — | BullMQ consumer for background jobs (agent execution, routines, memory synthesis, work intake) |
| **postgres** | `pgvector/pgvector:pg16` | 5432 | PostgreSQL 16 with pgvector extension pre-installed |
| **redis** | `redis:7-alpine` | 6379 | Session store, job queues, pub/sub |

The **worker** process runs the same API codebase but starts the BullMQ consumers instead of the HTTP server. This lets you scale workers independently of the API.

## Architecture

```
                    ┌──────────┐
  Browser ────────▶ │   web    │ :3000
                    └──────────┘
                         │
                    ┌──────────┐
                    │   api    │ :8000   ◀── REST + WebSocket
                    └────┬─────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐
     │ postgres  │  │  redis   │  │  worker   │
     │  :5432    │  │  :6379   │  │ (BullMQ)  │
     └──────────┘  └──────────┘  └──────────┘
```

## Environment Variables

Docker Compose reads from the `.env` file in the project root. All services share the same environment. See the [Configuration reference](/getting-started/configuration) for the full list.

Key variables for Docker:

```bash
# These defaults work out of the box with Docker Compose
DATABASE_URL="postgresql://hearth:hearth@postgres:5432/hearth"
REDIS_URL="redis://redis:6379"

# You must provide at least one
ANTHROPIC_API_KEY="sk-ant-..."
# or
OPENAI_API_KEY="sk-..."
```

::: tip
Note the hostnames `postgres` and `redis` instead of `localhost` — Docker Compose networking resolves service names automatically.
:::

::: warning
The default database credentials (`hearth:hearth`) are for development only. For any deployment accessible over a network, change these immediately. See the [Production Checklist](./production) for secure configuration guidance.
:::

## Production Configuration

For production deployments, create a `docker-compose.prod.yml` override:

```yaml
# docker-compose.prod.yml
services:
  web:
    restart: always
    environment:
      - NODE_ENV=production

  api:
    restart: always
    environment:
      - NODE_ENV=production

  worker:
    restart: always
    deploy:
      replicas: 2  # Scale workers for higher throughput

  postgres:
    restart: always
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"

  redis:
    restart: always
    command: redis-server --requirepass "${REDIS_PASSWORD}"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

Run with both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Security Hardening

Before exposing Hearth to a network:

1. **Change all default passwords** in `.env` — database, Redis, encryption key, session secret.
2. **Restrict exposed ports** — only the web port (3000) and API port (8000) need to be publicly accessible. Do not expose PostgreSQL (5432) or Redis (6379) to the internet.
3. **Place a reverse proxy** (nginx, Caddy, Traefik) in front with TLS termination.
4. **Set `NODE_ENV=production`** on all services.
5. **Disable the Docker socket mount** unless you need agent code execution. If enabled, use a read-only mount with restrictions.

See the full [Production Checklist](./production) for a complete hardening guide.

## Volumes and Persistence

| Volume | Service | Path | Purpose |
|---|---|---|---|
| `pgdata` | postgres | `/var/lib/postgresql/data` | Database files. **Back this up.** |
| `redisdata` | redis | `/data` | Redis AOF persistence. Losing this means losing in-flight job state — jobs will be retried. |

### Backups

```bash
# Database backup
docker compose exec postgres pg_dump -U hearth hearth > backup.sql

# Database restore
docker compose exec -T postgres psql -U hearth hearth < backup.sql
```

Schedule regular backups in production. The database contains all persistent state — users, sessions, tasks, memory, skills, and audit logs.

## Updating

```bash
git pull
docker compose build
docker compose up -d

# Run any new migrations
docker compose exec api npx prisma migrate deploy
```

::: danger
Always run database migrations before or immediately after deploying a new API version. Skipping migrations can cause runtime errors. Back up the database before migrating.
:::

## Scaling

The worker service handles CPU-intensive agent tasks. To scale workers:

```bash
docker compose up -d --scale worker=4
```

Each worker instance processes jobs from the shared Redis-backed BullMQ queues. Jobs are distributed automatically — no configuration needed.

For horizontal scaling beyond a single host, consider moving to the [Kubernetes deployment](./kubernetes).

## Monitoring

The API exposes a health endpoint at `GET /api/v1/health` that returns `{ status: "ok", timestamp, version }`. Use this with an external uptime monitor or a simple cron job to detect service failures.

To view logs:

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api

# Last 100 lines
docker compose logs --tail 100 worker
```

Hearth uses Pino for structured JSON logging. See [Monitoring & Health](./monitoring) for details on log aggregation and alerting.

## Troubleshooting

### Database connection refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

If running inside Docker, make sure `DATABASE_URL` uses `postgres` as the hostname (the Docker service name), not `localhost`.

### pgvector extension not found

```
ERROR: could not open extension control file "vector"
```

The `pgvector/pgvector:pg16` image includes the extension. If using a custom PostgreSQL image, install pgvector manually:

```bash
docker compose exec postgres psql -U hearth -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Redis connection timeout

Ensure Redis is healthy before the API starts. Docker Compose healthchecks handle this, but if you see timeouts on first start, wait for all services to be ready:

```bash
docker compose up -d
docker compose logs -f api  # Watch for "Server listening on port 8000"
```

For more issues, see the [Troubleshooting](./troubleshooting) guide.

## Related

- [Kubernetes & Helm](./kubernetes) — Production-grade deployment with horizontal scaling
- [Production Checklist](./production) — Security hardening and operational readiness
- [Monitoring & Health](./monitoring) — Health checks, logging, and alerting
