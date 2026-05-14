# Monitoring

Self-hosted operators should monitor application health, workers, queues, data stores, storage, and logs.

[[toc]]

## Health Endpoint

The API exposes:

```text
GET /api/v1/health
```

Use it for uptime checks and load balancer health checks.

## What to Monitor

| Area | Signals |
|---|---|
| API | Health, latency, 4xx/5xx rates, process restarts. |
| WebSocket | Disconnect rates, upgrade failures, room/subscription issues. |
| Workers | Job failures, queue depth, retry counts, stalled jobs. |
| Postgres | Connections, CPU, memory, disk, slow queries, backup success. |
| Redis | Memory, evictions, persistence, queue latency. |
| File storage | Disk usage, permissions, upload failures. |
| LLM providers | Error rates, timeouts, rate limits, token usage. |
| Integrations | Health check failures and credential expiration. |

## Logs

Hearth uses structured logging. Send API and worker logs to your log aggregation system and preserve enough history for incident review.

## Alerts

Start with alerts for:

- API health check failure.
- Worker crash loop.
- Queue backlog growth.
- Postgres disk pressure.
- Redis memory pressure.
- Repeated LLM provider failures.
- Integration failure spikes.
- Failed backups.
