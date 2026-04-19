# Self-Hosting

Hearth is designed to run on your own infrastructure. Your data never leaves your network.

## Deployment Options

- **[Docker Compose](/self-hosting/docker)** — The simplest way to deploy. Single-node setup with PostgreSQL, Redis, API, worker, and web frontend. Ideal for small teams and evaluation.
- **[Kubernetes & Helm](/self-hosting/kubernetes)** — Production-grade deployment with the Hearth Helm chart. Horizontal scaling, health checks, and ingress configuration.

## Operations

- **[Production Checklist](/self-hosting/production)** — Security hardening, TLS, secrets management, backups, and pre-launch verification.
- **[Monitoring & Health](/self-hosting/monitoring)** — Health check endpoints, structured logging, alerting, and metrics.
- **[Troubleshooting](/self-hosting/troubleshooting)** — Common issues, debugging techniques, and recovery procedures.

## Architecture

Hearth deploys as these services:

| Service | Description | Default Port |
|---------|-------------|-------------|
| **Web** | React SPA served via nginx | 3000 |
| **API** | Express + Socket.io server | 8000 |
| **Worker** | BullMQ job processor | — |
| **Docs** | VitePress documentation site | 3001 |
| **PostgreSQL** | Primary database with pgvector | 5432 |
| **Redis** | Cache, sessions, and job queue | 6379 |

All services are stateless except PostgreSQL and Redis. Scale the API and worker horizontally as needed.
