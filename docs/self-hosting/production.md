# Production Checklist

Security and operational readiness checklist for running Hearth in production. Work through each section before exposing your deployment to users.

## Secrets Management

### Generate Real Secrets

Never use the default values from `.env.example` or `values.yaml` in production. Generate cryptographically strong secrets for every sensitive value:

```bash
# ENCRYPTION_KEY — 64 hex characters, used for AES-256-GCM encryption of integration tokens
openssl rand -hex 32

# SESSION_SECRET — used to sign HTTP-only session cookies
openssl rand -base64 32

# Database password
openssl rand -base64 24

# Redis password
openssl rand -base64 24
```

### Store Secrets Securely

- **Docker Compose**: Use a `.env` file with restricted permissions (`chmod 600 .env`). Never commit `.env` to version control.
- **Kubernetes**: Use Kubernetes Secrets or an external secrets manager (Vault, AWS Secrets Manager, GCP Secret Manager). Reference them via `secrets.existingSecret` in the Helm chart.
- **General**: Rotate secrets periodically. Rotate immediately if a secret is ever exposed in logs, code, or error output.

### Verify No Defaults Remain

Check that none of these default values appear in your configuration:

- `ENCRYPTION_KEY` is not `change-me-in-production-64-hex-chars`
- `SESSION_SECRET` is not `change-me-in-production`
- Database password is not `hearth`
- Redis has a password set (not running without authentication)

## TLS / HTTPS

Enable HTTPS for all services. Unencrypted HTTP exposes session cookies, API keys, and user data to interception.

### With a Reverse Proxy

Place nginx, Caddy, or Traefik in front of Hearth for TLS termination:

```nginx
# nginx example
server {
    listen 443 ssl;
    server_name hearth.example.com;

    ssl_certificate /etc/ssl/certs/hearth.crt;
    ssl_certificate_key /etc/ssl/private/hearth.key;

    location / {
        proxy_pass http://localhost:3000;
    }

    location /api/ {
        proxy_pass http://localhost:8000;
    }

    location /socket.io/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### With Kubernetes

Enable TLS in the Helm chart ingress. Use [cert-manager](https://cert-manager.io/) for automatic certificate provisioning from Let's Encrypt, or provide your own TLS secret. See the [Kubernetes guide](./kubernetes#tls-configuration) for details.

### Verify

After enabling TLS, confirm:

- `http://` redirects to `https://`
- WebSocket connections upgrade successfully over `wss://`
- The `WEB_URL` environment variable uses `https://`

## Database

### Use a Managed Service

For production workloads, use a managed PostgreSQL service instead of the built-in container:

- **AWS**: RDS for PostgreSQL or Aurora PostgreSQL
- **GCP**: Cloud SQL for PostgreSQL
- **Azure**: Azure Database for PostgreSQL
- **Other**: Neon, Supabase, Crunchy Bridge

Managed services provide automated backups, failover, monitoring, and security patching.

### Requirements

- PostgreSQL 16 or later
- The `pgvector` extension must be enabled:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```
- Sufficient storage for your team's data (embeddings can grow quickly)

### Connection Pooling

Configure connection pooling to prevent exhausting database connections:

- Use PgBouncer or your managed service's built-in pooler
- Set `connection_limit` in the Prisma `DATABASE_URL` to match your pool size
- Example: `postgresql://user:pass@host:5432/hearth?connection_limit=20`

### Backups

- Enable automated daily backups with at least 7 days retention
- Test restore procedures periodically — untested backups are not backups
- For Docker deployments, schedule `pg_dump` via cron:
  ```bash
  0 2 * * * docker compose exec -T postgres pg_dump -U hearth hearth | gzip > /backups/hearth-$(date +\%Y\%m\%d).sql.gz
  ```

## Redis

### Use a Managed Service

For production, use a managed Redis service:

- **AWS**: ElastiCache for Redis
- **GCP**: Memorystore for Redis
- **Azure**: Azure Cache for Redis

### Configuration

- **Authentication**: Always set a password. Never run Redis without `requirepass`.
- **Max memory policy**: Set `maxmemory-policy allkeys-lru` to prevent out-of-memory crashes. BullMQ jobs are persistent and will be retried.
- **Persistence**: Enable AOF (append-only file) persistence for durability. Losing Redis data means in-flight jobs are lost, though they will be retried.
- **Memory**: Monitor usage. Alert if Redis memory exceeds 80% of the configured limit.

## Environment Variables

Set these for all production services:

```bash
# Required
NODE_ENV=production
WEB_URL=https://hearth.example.com  # Your actual domain, with https

# Database and Redis
DATABASE_URL=postgresql://user:password@db-host:5432/hearth
REDIS_URL=redis://:password@redis-host:6379

# Encryption
ENCRYPTION_KEY=<64 hex characters>
SESSION_SECRET=<random string>

# LLM provider (at least one)
ANTHROPIC_API_KEY=sk-ant-...
# and/or
OPENAI_API_KEY=sk-...
```

Verify `NODE_ENV=production` is set. In development mode, error responses include stack traces that leak internal details.

## File Storage

Configure persistent storage for file uploads:

- **Docker Compose**: Mount a named volume to the API container at the configured upload path.
- **Kubernetes**: The Helm chart creates a shared PVC (`fileStorage.size: 10Gi`). Ensure your cluster supports `ReadWriteMany` access mode.
- **External storage**: For larger deployments, configure S3-compatible object storage (AWS S3, MinIO, GCS) and update the file storage configuration.

Verify the upload directory has sufficient space and appropriate permissions. The default maximum upload size is 10 MB.

## Docker Socket

The Docker socket mount enables the agent to execute code in sandboxed containers. This is a powerful feature but a significant security surface.

- **If agent code execution is not needed**: Remove or comment out the Docker socket mount entirely.
- **If agent code execution is needed**:
  - Mount as read-only: `- /var/run/docker.sock:/var/run/docker.sock:ro`
  - Run the agent sandbox containers with restricted capabilities
  - Use a Docker socket proxy (like [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) to limit which API calls are allowed
  - Monitor container creation for unexpected activity

## Network Security

Restrict database and infrastructure ports to internal networks only:

- **PostgreSQL (5432)**: Internal only. Never expose to the public internet.
- **Redis (6379)**: Internal only. Never expose to the public internet.
- **API (8000)**: Expose through a reverse proxy with TLS, not directly.
- **Web (3000/80)**: Expose through a reverse proxy with TLS.

For Docker Compose, remove port bindings for internal services in your production override:

```yaml
# docker-compose.prod.yml
services:
  postgres:
    ports: []  # Remove public port binding
  redis:
    ports: []  # Remove public port binding
```

For Kubernetes, the Helm chart does not expose database or Redis services externally by default. Do not create LoadBalancer or NodePort services for them.

## Logging

Hearth uses Pino for structured JSON logging to stdout. In production:

- Collect logs from container stdout using your preferred log aggregation tool (ELK, Loki, Datadog, CloudWatch)
- Do not log to files inside containers — use stdout and let the container runtime handle log rotation
- Set appropriate log levels via the `LOG_LEVEL` environment variable (default: `info` in production)
- Monitor logs for `ERROR` and `FATAL` level entries

See [Monitoring & Health](./monitoring) for details on log format and alerting.

## Updates and Migrations

Follow this sequence when deploying a new version:

1. **Back up the database** before any upgrade
2. **Review the changelog** for breaking changes or required migration steps
3. **Test in a staging environment** first
4. **Run database migrations** before deploying the new API version:
   - Docker: `docker compose exec api npx prisma migrate deploy`
   - Kubernetes: `kubectl exec -it deploy/hearth-api -- npx prisma migrate deploy`
5. **Deploy the new images**
6. **Verify health checks** pass after deployment
7. **Pin image tags** to specific versions — never use `latest` in production

::: warning
Running a new API version against an old database schema can cause runtime errors. Always migrate first.
:::

## Pre-Launch Verification

Before opening access to users, verify:

- [ ] All default secrets have been replaced with generated values
- [ ] TLS is enabled and working (HTTPS, WSS)
- [ ] `NODE_ENV=production` is set on all services
- [ ] `WEB_URL` is set to the correct HTTPS domain
- [ ] Database backups are configured and tested
- [ ] Redis has authentication enabled
- [ ] PostgreSQL and Redis ports are not publicly accessible
- [ ] Health check endpoint (`GET /api/v1/health`) returns `200 OK`
- [ ] File uploads work and persist across restarts
- [ ] WebSocket connections establish successfully
- [ ] At least one LLM provider is configured and responding
- [ ] Logs are being collected and are accessible

## Related

- [Monitoring & Health](./monitoring) — Health checks, structured logging, and alerting
- [Kubernetes & Helm](./kubernetes) — Production-grade Kubernetes deployment
- [Docker Compose](./docker) — Single-node Docker deployment
- [Troubleshooting](./troubleshooting) — Common issues and debugging
