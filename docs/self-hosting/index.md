# Self-Hosting

Self-hosted Hearth is the open-source deployment path. You operate the application stack, data stores, secrets, backups, upgrades, monitoring, and network controls.

[[toc]]

## What You Operate

| Component | Purpose |
|---|---|
| Web app | React frontend served to users. |
| API | Express API and Socket.io server. |
| Worker | BullMQ consumers for agent execution, routines, memory, intake, and background jobs. |
| Postgres with pgvector | Persistent data, relational state, and embeddings. |
| Redis | Sessions, queues, cache, pub/sub, and rate limiting. |
| File storage | Uploads, artifacts, and task context files. |
| Reverse proxy or ingress | TLS, routing, WebSocket forwarding, and public access. |

## Deployment Paths

- [Docker Compose](/self-hosting/docker) for local evaluation, small deployments, and single-server installs.
- [Kubernetes and Helm](/self-hosting/kubernetes) for larger production deployments.

## Operator Checklist

1. Configure [environment variables](/self-hosting/configuration).
2. Generate and store [secrets](/self-hosting/secrets).
3. Enable TLS and route `/api/` and `/socket.io/` correctly.
4. Configure Postgres backups and restore testing.
5. Configure Redis persistence or accept queue-state loss tradeoffs.
6. Decide whether to use external managed Postgres and Redis.
7. Configure LLM providers.
8. Monitor API health, worker queues, database, Redis, storage, and logs.
9. Run database migrations during upgrades.

## Shared Product Docs

After deployment, the app experience is covered in:

- [Product Guide](/guide/)
- [Admin Guide](/admin/)
- [Developer Docs](/developers/)
