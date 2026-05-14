# Docker Compose

Docker Compose is the fastest self-hosted path for evaluation, development, and small single-server deployments.

[[toc]]

## Prerequisites

- Docker Engine 24+.
- Docker Compose v2.
- At least 4 GB RAM for a small test instance.
- A clone of the Hearth repository.
- At least one LLM provider key or local Ollama endpoint.

## Quickstart

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env
```

Edit `.env` and set at least one provider:

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

Open `http://localhost:3000` and complete setup.

## Services

| Service | Port | Purpose |
|---|---:|---|
| web | 3000 | Frontend. |
| api | 8000 | REST API and WebSocket server. |
| worker | none | Background job consumers. |
| postgres | 5432 | Postgres with pgvector. |
| redis | 6379 | Sessions, queues, cache, and pub/sub. |

## Production Use

For production, add a Compose override that sets restart policies, secure credentials, persistent volumes, and a reverse proxy with TLS.

Never expose Postgres or Redis directly to the internet.

## Updates

```bash
git pull
docker compose build
docker compose up -d
docker compose exec api npx prisma migrate deploy
```

Back up the database before migrations.
