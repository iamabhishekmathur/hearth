# Start Self-Hosted

Self-hosted Hearth is the open-source deployment path. You run the web app, API, worker, Postgres with pgvector, Redis, file storage, and networking in your own environment.

[[toc]]

## Quickstart with Docker Compose

The fastest local path is Docker Compose. It starts the web app, API server, background worker, Postgres, and Redis.

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env
```

Edit `.env` and set at least one LLM provider:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Start the stack:

```bash
docker compose up
```

Open `http://localhost:3000` and complete the setup wizard.

## Production Checklist

Before exposing a self-hosted instance to a network:

1. Generate unique `SESSION_SECRET` and `ENCRYPTION_KEY` values.
2. Change default database and Redis credentials.
3. Enable HTTPS behind a reverse proxy or ingress.
4. Configure backups for Postgres and file storage.
5. Decide whether to use hosted LLM providers, local Ollama, or both.
6. Restrict access to Postgres, Redis, and any Docker socket mounts.
7. Configure monitoring for the API health endpoint, worker queues, database, Redis, logs, and disk usage.
8. Run database migrations during upgrades.

## Development Setup

For local development with hot reloading:

```bash
pnpm install
docker compose up -d postgres redis
pnpm dev
```

| Service | URL |
|---|---|
| Web app | `http://localhost:3000` |
| API | `http://localhost:8000` |
| Health check | `http://localhost:8000/api/v1/health` |

## Next Docs

- [Docker Compose](/self-hosting/docker)
- [Kubernetes and Helm](/self-hosting/kubernetes)
- [Configuration](/self-hosting/configuration)
- [Secrets](/self-hosting/secrets)
- [Backups and Upgrades](/self-hosting/backups-and-upgrades)
- [Monitoring](/self-hosting/monitoring)
- [Troubleshooting](/self-hosting/troubleshooting)

## Shared Product Docs

After setup, the main product experience is covered in the shared [Product Guide](/guide/) and [Admin Guide](/admin/).
