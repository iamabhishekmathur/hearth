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

Generate the required secrets (Compose refuses to start without them):

```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
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

## Optional Features

Compose passes these through from `.env` when set:

- `CHATGPT_PLAN_ENABLED=true` turns on [Use Your ChatGPT Plan](/guide/chatgpt-plan). It works when you open Hearth on the same computer that runs Compose.
- `SSO_CALLBACK_SECRET` enables the SSO callback for an SSO proxy.

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

::: warning Upgrading from a release with default secrets
Compose now requires `ENCRYPTION_KEY` and `SESSION_SECRET` in `.env`, and the API refuses to start in production with the old development defaults. If you previously ran without setting them, integration tokens and LLM keys were encrypted with the default key: after you set a real `ENCRYPTION_KEY`, reconnect integrations and re-enter LLM provider keys. Everyone also needs to sign in again.
:::
