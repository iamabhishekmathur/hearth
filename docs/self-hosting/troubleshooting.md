# Troubleshooting

Common issues and solutions for self-hosted Hearth deployments.

## App Won't Start

### Symptoms

- Container exits immediately after starting
- Logs show connection errors on startup
- Health check never passes

### Solutions

**Check database connectivity.** The API server requires a reachable PostgreSQL instance before it can start.

```bash
# Docker Compose
docker compose logs api | grep -i "error\|ECONNREFUSED\|connect"

# Kubernetes
kubectl logs deploy/hearth-api -n hearth | grep -i "error\|ECONNREFUSED\|connect"
```

Verify `DATABASE_URL` is correct and the database host is reachable from the API container:

```bash
# Docker Compose — test from inside the API container
docker compose exec api sh -c 'nc -zv postgres 5432'

# Kubernetes
kubectl exec deploy/hearth-api -n hearth -- sh -c 'nc -zv hearth-postgres 5432'
```

**Check Redis connectivity.** The API also requires Redis for sessions and job queues.

```bash
docker compose exec api sh -c 'nc -zv redis 6379'
```

**Run database migrations.** If the database exists but tables are missing, the API will fail on startup:

```bash
# Docker Compose
docker compose exec api npx prisma migrate deploy

# Kubernetes
kubectl exec -it deploy/hearth-api -n hearth -- npx prisma migrate deploy
```

**Check environment variables.** Missing required environment variables cause immediate exit. Look for validation errors in the logs — Hearth uses Zod to validate configuration on startup and will report which variables are missing or malformed.

## WebSocket Disconnects

### Symptoms

- Chat messages stop updating in real time
- "Disconnected" indicator in the UI
- Browser console shows WebSocket connection errors

### Solutions

**Ensure your reverse proxy supports WebSocket upgrades.** This is the most common cause. For nginx:

```nginx
location /socket.io/ {
    proxy_pass http://api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

**Check ingress timeout annotations.** The Helm chart sets 3600-second timeouts by default. If you are using custom ingress configuration, ensure timeouts are long enough for persistent WebSocket connections:

```yaml
# Kubernetes nginx ingress
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```

**Check for load balancer issues.** If running behind a cloud load balancer (ALB, GCP LB), ensure:

- WebSocket support is enabled
- Idle timeout is set to at least 3600 seconds
- Sticky sessions are enabled if running multiple API replicas (Socket.io uses sticky sessions for HTTP long-polling fallback)

**Verify the `WEB_URL` environment variable** matches the actual URL users access. CORS and cookie settings depend on this value.

## Agent Not Responding

### Symptoms

- Chat messages sent but no agent response appears
- "Thinking..." indicator spins indefinitely
- Agent tasks show as queued but never complete

### Solutions

**Verify your LLM API key is set and valid.** The agent requires at least one configured LLM provider.

```bash
# Check if the key is set (shows first/last few characters)
docker compose exec api sh -c 'echo $ANTHROPIC_API_KEY | head -c 10'
```

**Check provider health in the admin panel.** Navigate to the admin LLM configuration page to see provider status and test connections:

```
https://hearth.example.com/admin/llm-config/providers
```

**Check worker logs.** Agent execution happens in the worker process, not the API:

```bash
# Docker Compose
docker compose logs -f worker

# Kubernetes
kubectl logs deploy/hearth-worker -n hearth -f
```

Look for errors related to LLM API calls — rate limiting, authentication failures, or network timeouts.

**Verify worker is running.** If the worker container is not running, jobs will queue indefinitely:

```bash
# Docker Compose
docker compose ps worker

# Kubernetes
kubectl get pods -l app=hearth-worker -n hearth
```

**Check BullMQ queue status.** Connect to Redis and inspect the queue:

```bash
docker compose exec redis redis-cli LLEN bull:agent-execution:wait
```

A growing wait queue with no processing indicates the worker is stuck or not consuming jobs.

## Integrations Failing

### Symptoms

- Integration shows "disconnected" or "error" status
- Webhook events are not being processed
- OAuth-connected services stop syncing

### Solutions

**Check integration health in the UI.** Go to Settings and then Integrations to see the status of each connected integration.

**Re-authenticate OAuth integrations.** OAuth tokens expire. Use the reconnect button in the integrations settings to re-authorize.

**Verify webhook URLs are accessible.** If Hearth is behind a firewall or on a private network, external services cannot deliver webhooks. Ensure the webhook endpoint is publicly reachable:

```
https://hearth.example.com/api/v1/webhooks/ingest
```

**Check integration credentials.** API keys or tokens may have been rotated on the provider side. Update credentials in Hearth's integration settings.

**Review webhook delivery logs.** Most integration providers (GitHub, Slack, Linear) offer webhook delivery logs in their settings. Check for failed deliveries, HTTP errors, or timeout responses.

## Slow Performance

### Symptoms

- Pages take a long time to load
- Agent responses are significantly delayed
- General sluggishness across the application

### Solutions

**Check database query performance.** Enable Prisma query logging to identify slow queries:

```bash
# Set in environment variables
DATABASE_QUERY_LOG=true
```

Look for queries taking more than 100ms. Common culprits:

- Missing pgvector indexes on embedding columns
- Large unindexed queries on the activity feed
- Full table scans on memory or task tables

**Verify pgvector indexes exist.** Run migrations to ensure all indexes are created:

```bash
docker compose exec api npx prisma migrate deploy
```

**Monitor Redis memory.** If Redis is under memory pressure, it may evict keys and cause cache misses or session invalidation:

```bash
docker compose exec redis redis-cli INFO memory
```

Key fields to check: `used_memory_human`, `maxmemory_human`, `evicted_keys`.

**Check resource allocation.** Ensure containers have sufficient CPU and memory. For Kubernetes, check if pods are being throttled:

```bash
kubectl top pods -n hearth
```

**Review worker throughput.** If agent tasks are slow, check if workers are overloaded. Scale up worker replicas:

```bash
# Docker Compose
docker compose up -d --scale worker=4

# Kubernetes — adjust in values.yaml or manually
kubectl scale deploy hearth-worker --replicas=4 -n hearth
```

## File Uploads Failing

### Symptoms

- Upload button shows an error
- Files appear to upload but are not saved
- Large files fail while small ones succeed

### Solutions

**Check upload size limits.** The default maximum upload size is 10 MB. If your reverse proxy has a lower limit, uploads will fail before reaching the API:

```nginx
# nginx
client_max_body_size 10m;
```

For Kubernetes nginx ingress, the Helm chart sets this via annotation:

```yaml
nginx.ingress.kubernetes.io/proxy-body-size: "10m"
```

**Verify file storage volume.** Ensure the upload directory is mounted and has available space:

```bash
# Docker Compose
docker compose exec api df -h /app/uploads

# Kubernetes
kubectl exec deploy/hearth-api -n hearth -- df -h /app/uploads
```

**Check MIME type restrictions.** Hearth restricts uploads to allowed MIME types for security. Check the API logs for rejected file types:

```bash
docker compose logs api | grep -i "mime\|upload\|file"
```

**Verify volume permissions.** The upload directory must be writable by the Node.js process (typically UID 1000 inside the container):

```bash
docker compose exec api ls -la /app/uploads
```

## Migrations Failing

### Symptoms

- `prisma migrate deploy` exits with an error
- API fails to start due to schema mismatch
- Errors referencing missing columns or tables

### Solutions

**Check PostgreSQL version.** Hearth requires PostgreSQL 16 or later. The pgvector extension compatibility depends on the PostgreSQL version:

```bash
docker compose exec postgres psql -U hearth -c "SELECT version();"
```

**Ensure the pgvector extension is enabled.** Some migrations require the `vector` type. If the extension is missing, migrations referencing vector columns will fail:

```bash
docker compose exec postgres psql -U hearth -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Then retry the migration:

```bash
docker compose exec api npx prisma migrate deploy
```

**Check migration history.** If a migration partially applied (e.g., due to a crash), the migration table may be in an inconsistent state:

```bash
docker compose exec postgres psql -U hearth -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

Look for migrations with a non-null `rolled_back_at` or null `finished_at`. You may need to manually resolve the migration state — consult the [Prisma migration troubleshooting docs](https://www.prisma.io/docs/guides/database/production-troubleshooting).

**Verify database connectivity from the API container.** The migration tool connects using `DATABASE_URL`. Ensure the URL is correct and the database is reachable.

## Docker Build Fails

### Symptoms

- `docker compose build` fails during dependency installation
- Build errors referencing missing lockfile or packages
- Node.js version mismatch errors

### Solutions

**Ensure `pnpm-lock.yaml` is committed.** The Dockerfiles use `--frozen-lockfile` to install dependencies. If the lockfile is missing or out of date, the build will fail:

```bash
git status pnpm-lock.yaml
# If modified but not committed:
git add pnpm-lock.yaml && git commit -m "Update lockfile"
```

**If `--frozen-lockfile` fails**, it means `package.json` and `pnpm-lock.yaml` are out of sync. Run `pnpm install` locally to regenerate the lockfile, then commit it:

```bash
pnpm install
git add pnpm-lock.yaml
git commit -m "Regenerate lockfile"
```

**Check Node.js version.** The Dockerfiles use `node:22-alpine`. If you have customized the Dockerfile, ensure the Node.js version matches:

```dockerfile
FROM node:22-alpine
```

**Clear Docker build cache.** Stale build layers can cause unexpected failures:

```bash
docker compose build --no-cache
```

**Check disk space.** Docker builds require significant disk space for node_modules and TypeScript compilation:

```bash
docker system df
# Clean up if needed
docker system prune
```

## Getting Help

If the solutions above do not resolve your issue:

1. **Check the logs carefully.** Most issues produce descriptive error messages. Run `docker compose logs` or `kubectl logs` and search for `ERROR` or `FATAL` entries.
2. **Search existing issues** on the [GitHub repository](https://github.com/iamabhishekmathur/hearth/issues).
3. **Open a new issue** with:
   - Hearth version (from the health endpoint or `package.json`)
   - Deployment method (Docker Compose or Kubernetes)
   - Relevant log output (redact any secrets or API keys)
   - Steps to reproduce the issue

## Related

- [Monitoring & Health](./monitoring) — Health endpoints, structured logging, and alerting
- [Configuration](/getting-started/configuration) — Full environment variable reference
- [Production Checklist](./production) — Pre-launch verification steps
