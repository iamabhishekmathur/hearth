# Monitoring & Health

Observe and monitor your Hearth deployment with health endpoints, structured logging, and alerting.

## Health Endpoint

The API server exposes a health check endpoint:

```
GET /api/v1/health
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-04-17T12:00:00.000Z",
  "version": "0.1.0"
}
```

Use this endpoint for:

- Uptime monitoring (Pingdom, UptimeRobot, Checkly, etc.)
- Load balancer health checks
- Kubernetes readiness and liveness probes
- Docker Compose healthcheck configuration

A `200` response with `"status": "ok"` indicates the API server is running and can accept requests. A non-200 response or timeout indicates the service needs attention.

## Kubernetes Probes

The Helm chart configures readiness and liveness probes for the API pods by default:

```yaml
# Already configured in the Helm chart templates
readinessProbe:
  httpGet:
    path: /api/v1/health
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /api/v1/health
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3
```

- **Readiness probe**: Kubernetes routes traffic to the pod only after it passes. The 5-second initial delay gives the Node.js server time to start.
- **Liveness probe**: Kubernetes restarts the pod if it fails three consecutive checks (90 seconds of unhealthiness). The longer interval and initial delay prevent restarts during normal startup.

You do not need to add these manually — they are included in the chart templates. Override the values in `values.yaml` if you need different timing:

```yaml
api:
  readinessProbe:
    initialDelaySeconds: 10
  livenessProbe:
    initialDelaySeconds: 20
```

## Structured Logging

Hearth uses [Pino](https://getpino.io/) for structured JSON logging. All log output goes to stdout, following the twelve-factor app methodology.

### Log Format

Each log line is a JSON object:

```json
{"level":30,"time":1713355200000,"msg":"Server listening on port 8000","pid":1}
```

HTTP request logs include additional fields:

```json
{
  "level": 30,
  "time": 1713355200000,
  "msg": "request completed",
  "req": {
    "method": "GET",
    "url": "/api/v1/health",
    "remoteAddress": "10.0.0.1"
  },
  "res": {
    "statusCode": 200
  },
  "responseTime": 2
}
```

Error logs include the error object:

```json
{
  "level": 50,
  "time": 1713355200000,
  "msg": "Database connection failed",
  "err": {
    "type": "Error",
    "message": "connect ECONNREFUSED 10.0.0.5:5432",
    "stack": "Error: connect ECONNREFUSED..."
  }
}
```

### Log Levels

| Level | Value | Description |
|-------|-------|-------------|
| `trace` | 10 | Verbose debugging (disabled by default) |
| `debug` | 20 | Development debugging |
| `info` | 30 | Normal operational messages |
| `warn` | 40 | Unexpected but non-critical issues |
| `error` | 50 | Errors requiring attention |
| `fatal` | 60 | Unrecoverable errors, process will exit |

Set the log level with the `LOG_LEVEL` environment variable. Default is `info` in production and `debug` in development.

### Pretty Printing (Development)

For local development, pipe logs through `pino-pretty`:

```bash
docker compose logs -f api | npx pino-pretty
```

Never use pretty printing in production — it is significantly slower and harder to parse by log aggregation tools.

## Key Metrics to Monitor

### API Server

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Response time (p95) | Latency on API endpoints | > 500ms |
| Error rate | 5xx responses as a percentage of total | > 1% |
| Request rate | Requests per second | Baseline dependent |
| WebSocket connections | Active concurrent connections | Capacity dependent |

### Worker (BullMQ)

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Queue depth | Jobs waiting to be processed | > 100 (sustained) |
| Job processing time | Average time per job | > 30s for non-agent jobs |
| Failed jobs | Jobs that errored and exceeded retries | Any |
| Active workers | Number of worker processes consuming jobs | < configured count |

### Database (PostgreSQL)

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Connection pool utilization | Active connections vs. pool size | > 80% |
| Query duration (p95) | Slow queries | > 100ms |
| Disk usage | Database size growth | > 80% of allocated storage |
| Replication lag | If using read replicas | > 1s |

### Redis

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Memory usage | Used memory vs. maxmemory | > 80% |
| Connected clients | Number of active connections | Capacity dependent |
| Eviction rate | Keys evicted due to memory pressure | Any (shouldn't happen) |
| Command latency | Average command execution time | > 1ms |

## Alerting Suggestions

Configure alerts for conditions that require human intervention:

### Critical (Page immediately)

- API health check fails for > 2 minutes
- Database connection errors
- Worker process count drops to zero
- Redis out of memory

### Warning (Investigate during business hours)

- Worker queue depth exceeds threshold for > 10 minutes
- API error rate exceeds 1% for > 5 minutes
- Redis memory usage exceeds 80%
- Database connection pool utilization exceeds 80%
- Disk usage exceeds 80% on any persistent volume

### Informational (Review in dashboards)

- Deployment events (new version rolled out)
- Database migration completed
- Scaling events (HPA replica changes)
- LLM provider rate limiting or errors

## Log Aggregation

Forward container stdout to your log aggregation platform. Hearth does not require any specific log collector — any tool that reads container stdout works.

### Common Options

| Platform | Collection Method |
|----------|------------------|
| **ELK Stack** | Filebeat or Fluentd sidecar reading container logs |
| **Grafana Loki** | Promtail DaemonSet or Docker logging driver |
| **Datadog** | Datadog Agent with container log collection |
| **AWS CloudWatch** | CloudWatch Logs agent or AWS FireLens |
| **GCP Cloud Logging** | Automatic for GKE; Fluentd for other environments |

### Docker Compose

Configure the Docker logging driver to forward logs:

```yaml
# docker-compose.prod.yml
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Or use a third-party logging driver (fluentd, gelf, syslog) to forward directly to your aggregation platform.

### Kubernetes

On Kubernetes, container stdout is collected automatically by the kubelet. Install a log collector DaemonSet (Promtail, Filebeat, Fluentd) to forward logs to your aggregation backend.

The Helm chart does not include a log collector — use your cluster's existing logging infrastructure.

## Dashboard Examples

If using Grafana, create dashboards for:

1. **API Overview**: Request rate, error rate, response time percentiles, active WebSocket connections
2. **Worker Overview**: Queue depth by queue name, job processing time, failed job count, active worker count
3. **Infrastructure**: PostgreSQL connection pool, query duration, Redis memory, disk usage across PVCs

## Related

- [Production Checklist](./production) — Security hardening and operational readiness
- [Troubleshooting](./troubleshooting) — Common issues and debugging techniques
- [Kubernetes & Helm](./kubernetes) — Kubernetes deployment with built-in probes
