# Self-Hosting Guide

Deploy and operate Hearth on your own infrastructure.

[[toc]]

---

## Docker Compose

Deploy Hearth on a single server using Docker Compose. This is the simplest self-hosting option — ideal for small teams, internal deployments, and evaluation before scaling to Kubernetes.

### Prerequisites

- Docker Engine 24+ and Docker Compose v2
- At least 4 GB RAM and 2 CPU cores
- A clone of the Hearth repository
- At least one LLM API key (Anthropic, OpenAI, or a local Ollama instance)

### Getting Started

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env
# Edit .env — add at least one LLM API key
```

Review the `.env` file and set your secrets before starting. See the [Production Checklist](#production-checklist) for guidance on generating secure values for `ENCRYPTION_KEY`, `SESSION_SECRET`, and database passwords.

```bash
docker compose up
```

The first build takes a few minutes to install dependencies and compile TypeScript. Subsequent starts are fast thanks to Docker layer caching.

Once running, open `http://localhost:3000` in your browser.

### Service Overview

| Service | Image | Port | Description |
|---|---|---|---|
| **web** | Built from `apps/web/` | 3000 | React frontend served by Vite (dev) or nginx (production) |
| **api** | Built from `apps/api/` | 8000 | Express API server with WebSocket support |
| **worker** | Built from `apps/api/` | — | BullMQ consumer for background jobs (agent execution, routines, memory synthesis, work intake) |
| **postgres** | `pgvector/pgvector:pg16` | 5432 | PostgreSQL 16 with pgvector extension pre-installed |
| **redis** | `redis:7-alpine` | 6379 | Session store, job queues, pub/sub |

The **worker** process runs the same API codebase but starts the BullMQ consumers instead of the HTTP server. This lets you scale workers independently of the API.

### Architecture

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

### Environment Variables

Docker Compose reads from the `.env` file in the project root. All services share the same environment. See the [Configuration reference](/getting-started/#configuration-reference) for the full list.

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
The default database credentials (`hearth:hearth`) are for development only. For any deployment accessible over a network, change these immediately. See the [Production Checklist](#production-checklist) for secure configuration guidance.
:::

### Production Configuration

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

See the full [Production Checklist](#production-checklist) for a complete hardening guide.

### Volumes and Persistence

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

### Updating

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

### Scaling

The worker service handles CPU-intensive agent tasks. To scale workers:

```bash
docker compose up -d --scale worker=4
```

Each worker instance processes jobs from the shared Redis-backed BullMQ queues. Jobs are distributed automatically — no configuration needed.

For horizontal scaling beyond a single host, consider moving to the [Kubernetes deployment](#kubernetes--helm).

### Docker Monitoring

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

Hearth uses Pino for structured JSON logging. See [Monitoring & Health](#monitoring--health) for details on log aggregation and alerting.

### Docker Troubleshooting

#### Database connection refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

If running inside Docker, make sure `DATABASE_URL` uses `postgres` as the hostname (the Docker service name), not `localhost`.

#### pgvector extension not found

```
ERROR: could not open extension control file "vector"
```

The `pgvector/pgvector:pg16` image includes the extension. If using a custom PostgreSQL image, install pgvector manually:

```bash
docker compose exec postgres psql -U hearth -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

#### Redis connection timeout

Ensure Redis is healthy before the API starts. Docker Compose healthchecks handle this, but if you see timeouts on first start, wait for all services to be ready:

```bash
docker compose up -d
docker compose logs -f api  # Watch for "Server listening on port 8000"
```

For more issues, see the [Troubleshooting](#troubleshooting) section.

## Kubernetes & Helm

Deploy Hearth on Kubernetes using the official Helm chart for production-grade scaling, health checks, and ingress management.

### Prerequisites

- A Kubernetes cluster (1.26+)
- [Helm 3+](https://helm.sh/docs/intro/install/) installed locally
- `kubectl` configured to access your cluster
- A container registry with Hearth images built and pushed (see [Building Images](#building-images) below)

### Chart Location

The Helm chart lives in the repository at:

```
deploy/helm/hearth/
```

### Quick Install

```bash
# From the repository root
helm install hearth deploy/helm/hearth -f values.yaml
```

To install into a specific namespace:

```bash
kubectl create namespace hearth
helm install hearth deploy/helm/hearth -f values.yaml -n hearth
```

### Chart Values

The Helm chart is configured through `values.yaml`. Below are the key sections and their defaults.

#### API Server

```yaml
api:
  replicaCount: 2
  image:
    repository: hearth-api
    tag: "0.1.0"
  port: 8000
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: "1"
      memory: 1Gi
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
```

The API server handles REST endpoints and WebSocket connections. Two replicas provide redundancy; the HPA scales up under load.

#### Worker

```yaml
worker:
  replicaCount: 1
  image:
    repository: hearth-api
    tag: "0.1.0"
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: "2"
      memory: 2Gi
  autoscaling:
    enabled: true
    minReplicas: 1
    maxReplicas: 5
    targetCPUUtilizationPercentage: 80
```

Workers process BullMQ jobs — agent execution, routines, memory synthesis, and work intake. They are CPU-intensive; allocate more resources here if agent tasks queue up.

#### Web Frontend

```yaml
web:
  replicaCount: 2
  image:
    repository: hearth-web
    tag: "0.1.0"
  port: 80
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 250m
      memory: 256Mi
```

The web frontend is a static React SPA served by nginx. It is lightweight and requires minimal resources.

#### Documentation Site

```yaml
docs:
  replicaCount: 1
  image:
    repository: hearth-docs
    tag: "0.1.0"
  port: 80
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 100m
      memory: 128Mi
```

The docs site is a VitePress static site. A single replica with minimal resources is sufficient.

#### PostgreSQL

```yaml
postgres:
  image:
    repository: pgvector/pgvector
    tag: pg16
  storage: 20Gi
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: "2"
      memory: 4Gi
```

The built-in PostgreSQL is suitable for evaluation and small teams. For production, use a managed PostgreSQL service (AWS RDS, GCP Cloud SQL, Neon, etc.) and set `postgres.enabled: false` with an external `DATABASE_URL` in secrets.

#### Redis

```yaml
redis:
  image:
    repository: redis
    tag: 7-alpine
  storage: 5Gi
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

Redis handles session storage, BullMQ job queues, and pub/sub for WebSocket fan-out. For production, consider a managed Redis service (AWS ElastiCache, GCP Memorystore, etc.) and set `redis.enabled: false`.

#### Secrets

```yaml
secrets:
  databaseUrl: "postgresql://hearth:hearth@hearth-postgres:5432/hearth"
  encryptionKey: "change-me-in-production-64-hex-chars"
  sessionSecret: "change-me-in-production"
```

::: danger
Never use the default secret values in production. Generate real secrets before deploying:

```bash
# Generate ENCRYPTION_KEY (64 hex characters)
openssl rand -hex 32

# Generate SESSION_SECRET
openssl rand -base64 32

# Generate database password
openssl rand -base64 24
```
:::

You can also reference existing Kubernetes secrets instead of inline values:

```yaml
secrets:
  existingSecret: "hearth-secrets"
```

#### File Storage

```yaml
fileStorage:
  size: 10Gi
  storageClass: ""  # Uses cluster default
  accessModes:
    - ReadWriteMany
```

A shared PersistentVolumeClaim for file uploads. Ensure your cluster supports `ReadWriteMany` access mode (e.g., via NFS, EFS, or a CSI driver). Alternatively, configure external object storage (S3, GCS, MinIO).

#### Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  host: hearth.local
  tls:
    enabled: false
    secretName: hearth-tls
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
  docs:
    host: docs.hearth.local
```

### Ingress Routing

The Helm chart configures ingress rules that route traffic to the appropriate services:

| URL Pattern | Service | Notes |
|---|---|---|
| `hearth.local/` | web | React SPA frontend |
| `hearth.local/api/` | api | REST API endpoints |
| `hearth.local/socket.io/` | api | WebSocket connections |
| `docs.hearth.local/` | docs | Documentation site |

The WebSocket path requires special proxy configuration. The Helm chart includes nginx annotations for connection upgrades and extended timeouts (3600s) by default.

#### Custom Host

Override the host in your `values.yaml`:

```yaml
ingress:
  host: hearth.example.com
  docs:
    host: docs.hearth.example.com
```

### TLS Configuration

Enable TLS in your values file and provide a certificate:

```yaml
ingress:
  tls:
    enabled: true
    secretName: hearth-tls
```

#### Using cert-manager

If you have [cert-manager](https://cert-manager.io/) installed, add the annotation:

```yaml
ingress:
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    enabled: true
    secretName: hearth-tls
```

#### Bringing Your Own Certificate

Create a TLS secret manually:

```bash
kubectl create secret tls hearth-tls \
  --cert=tls.crt \
  --key=tls.key \
  -n hearth
```

### Scaling

Horizontal Pod Autoscaling (HPA) is enabled by default for the API and worker services. The HPA scales based on CPU utilization:

- **API**: 2-10 replicas, scales at 70% CPU
- **Worker**: 1-5 replicas, scales at 80% CPU

To adjust scaling parameters:

```yaml
api:
  autoscaling:
    minReplicas: 3
    maxReplicas: 20
    targetCPUUtilizationPercentage: 60
```

To disable autoscaling and use fixed replica counts:

```yaml
api:
  autoscaling:
    enabled: false
  replicaCount: 4
```

### Building Images

Build and push Hearth container images to your registry before deploying:

```bash
# Web frontend
docker build -t your-registry/hearth-web:0.1.0 -f apps/web/Dockerfile .

# API server and worker (same image)
docker build -t your-registry/hearth-api:0.1.0 -f apps/api/Dockerfile .

# Documentation site
docker build -t your-registry/hearth-docs:0.1.0 -f docs/Dockerfile .

# Push all images
docker push your-registry/hearth-web:0.1.0
docker push your-registry/hearth-api:0.1.0
docker push your-registry/hearth-docs:0.1.0
```

Then update `values.yaml` to reference your registry:

```yaml
api:
  image:
    repository: your-registry/hearth-api
    tag: "0.1.0"
web:
  image:
    repository: your-registry/hearth-web
    tag: "0.1.0"
docs:
  image:
    repository: your-registry/hearth-docs
    tag: "0.1.0"
```

### Upgrading

```bash
# Update chart values
helm upgrade hearth deploy/helm/hearth -f values.yaml -n hearth

# Run database migrations (after pods are running)
kubectl exec -it deploy/hearth-api -n hearth -- npx prisma migrate deploy
```

::: warning
Always run database migrations before or immediately after deploying a new version. Back up the database first. See [Production Checklist](#production-checklist) for a safe upgrade procedure.
:::

### Uninstalling

```bash
helm uninstall hearth -n hearth
```

This removes all Kubernetes resources created by the chart. PersistentVolumeClaims are retained by default to prevent data loss. Delete them manually if needed:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=hearth -n hearth
```

## Production Checklist

Security and operational readiness checklist for running Hearth in production. Work through each section before exposing your deployment to users.

### Secrets Management

#### Generate Real Secrets

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

#### Store Secrets Securely

- **Docker Compose**: Use a `.env` file with restricted permissions (`chmod 600 .env`). Never commit `.env` to version control.
- **Kubernetes**: Use Kubernetes Secrets or an external secrets manager (Vault, AWS Secrets Manager, GCP Secret Manager). Reference them via `secrets.existingSecret` in the Helm chart.
- **General**: Rotate secrets periodically. Rotate immediately if a secret is ever exposed in logs, code, or error output.

#### Verify No Defaults Remain

Check that none of these default values appear in your configuration:

- `ENCRYPTION_KEY` is not `change-me-in-production-64-hex-chars`
- `SESSION_SECRET` is not `change-me-in-production`
- Database password is not `hearth`
- Redis has a password set (not running without authentication)

### TLS / HTTPS

Enable HTTPS for all services. Unencrypted HTTP exposes session cookies, API keys, and user data to interception.

#### With a Reverse Proxy

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

#### With Kubernetes

Enable TLS in the Helm chart ingress. Use [cert-manager](https://cert-manager.io/) for automatic certificate provisioning from Let's Encrypt, or provide your own TLS secret. See the [Kubernetes TLS Configuration](#tls-configuration) section for details.

#### Verify

After enabling TLS, confirm:

- `http://` redirects to `https://`
- WebSocket connections upgrade successfully over `wss://`
- The `WEB_URL` environment variable uses `https://`

### Database

#### Use a Managed Service

For production workloads, use a managed PostgreSQL service instead of the built-in container:

- **AWS**: RDS for PostgreSQL or Aurora PostgreSQL
- **GCP**: Cloud SQL for PostgreSQL
- **Azure**: Azure Database for PostgreSQL
- **Other**: Neon, Supabase, Crunchy Bridge

Managed services provide automated backups, failover, monitoring, and security patching.

#### Requirements

- PostgreSQL 16 or later
- The `pgvector` extension must be enabled:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```
- Sufficient storage for your team's data (embeddings can grow quickly)

#### Connection Pooling

Configure connection pooling to prevent exhausting database connections:

- Use PgBouncer or your managed service's built-in pooler
- Set `connection_limit` in the Prisma `DATABASE_URL` to match your pool size
- Example: `postgresql://user:pass@host:5432/hearth?connection_limit=20`

#### Backups

- Enable automated daily backups with at least 7 days retention
- Test restore procedures periodically — untested backups are not backups
- For Docker deployments, schedule `pg_dump` via cron:
  ```bash
  0 2 * * * docker compose exec -T postgres pg_dump -U hearth hearth | gzip > /backups/hearth-$(date +\%Y\%m\%d).sql.gz
  ```

### Redis

#### Use a Managed Service

For production, use a managed Redis service:

- **AWS**: ElastiCache for Redis
- **GCP**: Memorystore for Redis
- **Azure**: Azure Cache for Redis

#### Configuration

- **Authentication**: Always set a password. Never run Redis without `requirepass`.
- **Max memory policy**: Set `maxmemory-policy allkeys-lru` to prevent out-of-memory crashes. BullMQ jobs are persistent and will be retried.
- **Persistence**: Enable AOF (append-only file) persistence for durability. Losing Redis data means in-flight jobs are lost, though they will be retried.
- **Memory**: Monitor usage. Alert if Redis memory exceeds 80% of the configured limit.

### Environment Variables

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

### File Storage

Configure persistent storage for file uploads:

- **Docker Compose**: Mount a named volume to the API container at the configured upload path.
- **Kubernetes**: The Helm chart creates a shared PVC (`fileStorage.size: 10Gi`). Ensure your cluster supports `ReadWriteMany` access mode.
- **External storage**: For larger deployments, configure S3-compatible object storage (AWS S3, MinIO, GCS) and update the file storage configuration.

Verify the upload directory has sufficient space and appropriate permissions. The default maximum upload size is 10 MB.

### Docker Socket

The Docker socket mount enables the agent to execute code in sandboxed containers. This is a powerful feature but a significant security surface.

- **If agent code execution is not needed**: Remove or comment out the Docker socket mount entirely.
- **If agent code execution is needed**:
  - Mount as read-only: `- /var/run/docker.sock:/var/run/docker.sock:ro`
  - Run the agent sandbox containers with restricted capabilities
  - Use a Docker socket proxy (like [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) to limit which API calls are allowed
  - Monitor container creation for unexpected activity

### Network Security

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

### Logging

Hearth uses Pino for structured JSON logging to stdout. In production:

- Collect logs from container stdout using your preferred log aggregation tool (ELK, Loki, Datadog, CloudWatch)
- Do not log to files inside containers — use stdout and let the container runtime handle log rotation
- Set appropriate log levels via the `LOG_LEVEL` environment variable (default: `info` in production)
- Monitor logs for `ERROR` and `FATAL` level entries

See [Monitoring & Health](#monitoring--health) for details on log format and alerting.

### Updates and Migrations

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

### Pre-Launch Verification

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

## Monitoring & Health

Observe and monitor your Hearth deployment with health endpoints, structured logging, and alerting.

### Health Endpoint

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

### Kubernetes Probes

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

### Structured Logging

Hearth uses [Pino](https://getpino.io/) for structured JSON logging. All log output goes to stdout, following the twelve-factor app methodology.

#### Log Format

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

#### Log Levels

| Level | Value | Description |
|-------|-------|-------------|
| `trace` | 10 | Verbose debugging (disabled by default) |
| `debug` | 20 | Development debugging |
| `info` | 30 | Normal operational messages |
| `warn` | 40 | Unexpected but non-critical issues |
| `error` | 50 | Errors requiring attention |
| `fatal` | 60 | Unrecoverable errors, process will exit |

Set the log level with the `LOG_LEVEL` environment variable. Default is `info` in production and `debug` in development.

#### Pretty Printing (Development)

For local development, pipe logs through `pino-pretty`:

```bash
docker compose logs -f api | npx pino-pretty
```

Never use pretty printing in production — it is significantly slower and harder to parse by log aggregation tools.

### Key Metrics to Monitor

#### API Server

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Response time (p95) | Latency on API endpoints | > 500ms |
| Error rate | 5xx responses as a percentage of total | > 1% |
| Request rate | Requests per second | Baseline dependent |
| WebSocket connections | Active concurrent connections | Capacity dependent |

#### Worker (BullMQ)

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Queue depth | Jobs waiting to be processed | > 100 (sustained) |
| Job processing time | Average time per job | > 30s for non-agent jobs |
| Failed jobs | Jobs that errored and exceeded retries | Any |
| Active workers | Number of worker processes consuming jobs | < configured count |

#### Database (PostgreSQL)

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Connection pool utilization | Active connections vs. pool size | > 80% |
| Query duration (p95) | Slow queries | > 100ms |
| Disk usage | Database size growth | > 80% of allocated storage |
| Replication lag | If using read replicas | > 1s |

#### Redis

| Metric | What to Watch | Warning Threshold |
|--------|--------------|-------------------|
| Memory usage | Used memory vs. maxmemory | > 80% |
| Connected clients | Number of active connections | Capacity dependent |
| Eviction rate | Keys evicted due to memory pressure | Any (shouldn't happen) |
| Command latency | Average command execution time | > 1ms |

### Alerting Suggestions

Configure alerts for conditions that require human intervention:

#### Critical (Page immediately)

- API health check fails for > 2 minutes
- Database connection errors
- Worker process count drops to zero
- Redis out of memory

#### Warning (Investigate during business hours)

- Worker queue depth exceeds threshold for > 10 minutes
- API error rate exceeds 1% for > 5 minutes
- Redis memory usage exceeds 80%
- Database connection pool utilization exceeds 80%
- Disk usage exceeds 80% on any persistent volume

#### Informational (Review in dashboards)

- Deployment events (new version rolled out)
- Database migration completed
- Scaling events (HPA replica changes)
- LLM provider rate limiting or errors

### Log Aggregation

Forward container stdout to your log aggregation platform. Hearth does not require any specific log collector — any tool that reads container stdout works.

#### Common Options

| Platform | Collection Method |
|----------|------------------|
| **ELK Stack** | Filebeat or Fluentd sidecar reading container logs |
| **Grafana Loki** | Promtail DaemonSet or Docker logging driver |
| **Datadog** | Datadog Agent with container log collection |
| **AWS CloudWatch** | CloudWatch Logs agent or AWS FireLens |
| **GCP Cloud Logging** | Automatic for GKE; Fluentd for other environments |

#### Docker Compose

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

#### Kubernetes

On Kubernetes, container stdout is collected automatically by the kubelet. Install a log collector DaemonSet (Promtail, Filebeat, Fluentd) to forward logs to your aggregation backend.

The Helm chart does not include a log collector — use your cluster's existing logging infrastructure.

### Dashboard Examples

If using Grafana, create dashboards for:

1. **API Overview**: Request rate, error rate, response time percentiles, active WebSocket connections
2. **Worker Overview**: Queue depth by queue name, job processing time, failed job count, active worker count
3. **Infrastructure**: PostgreSQL connection pool, query duration, Redis memory, disk usage across PVCs

## Troubleshooting

Common issues and solutions for self-hosted Hearth deployments.

### App Won't Start

#### Symptoms

- Container exits immediately after starting
- Logs show connection errors on startup
- Health check never passes

#### Solutions

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

### WebSocket Disconnects

#### Symptoms

- Chat messages stop updating in real time
- "Disconnected" indicator in the UI
- Browser console shows WebSocket connection errors

#### Solutions

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

### Agent Not Responding

#### Symptoms

- Chat messages sent but no agent response appears
- "Thinking..." indicator spins indefinitely
- Agent tasks show as queued but never complete

#### Solutions

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

### Integrations Failing

#### Symptoms

- Integration shows "disconnected" or "error" status
- Webhook events are not being processed
- OAuth-connected services stop syncing

#### Solutions

**Check integration health in the UI.** Go to Settings and then Integrations to see the status of each connected integration.

**Re-authenticate OAuth integrations.** OAuth tokens expire. Use the reconnect button in the integrations settings to re-authorize.

**Verify webhook URLs are accessible.** If Hearth is behind a firewall or on a private network, external services cannot deliver webhooks. Ensure the webhook endpoint is publicly reachable:

```
https://hearth.example.com/api/v1/webhooks/ingest
```

**Check integration credentials.** API keys or tokens may have been rotated on the provider side. Update credentials in Hearth's integration settings.

**Review webhook delivery logs.** Most integration providers (GitHub, Slack, Linear) offer webhook delivery logs in their settings. Check for failed deliveries, HTTP errors, or timeout responses.

### Slow Performance

#### Symptoms

- Pages take a long time to load
- Agent responses are significantly delayed
- General sluggishness across the application

#### Solutions

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

### File Uploads Failing

#### Symptoms

- Upload button shows an error
- Files appear to upload but are not saved
- Large files fail while small ones succeed

#### Solutions

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

### Migrations Failing

#### Symptoms

- `prisma migrate deploy` exits with an error
- API fails to start due to schema mismatch
- Errors referencing missing columns or tables

#### Solutions

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

### Docker Build Fails

#### Symptoms

- `docker compose build` fails during dependency installation
- Build errors referencing missing lockfile or packages
- Node.js version mismatch errors

#### Solutions

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

### Getting Help

If the solutions above do not resolve your issue:

1. **Check the logs carefully.** Most issues produce descriptive error messages. Run `docker compose logs` or `kubectl logs` and search for `ERROR` or `FATAL` entries.
2. **Search existing issues** on the [GitHub repository](https://github.com/iamabhishekmathur/hearth/issues).
3. **Open a new issue** with:
   - Hearth version (from the health endpoint or `package.json`)
   - Deployment method (Docker Compose or Kubernetes)
   - Relevant log output (redact any secrets or API keys)
   - Steps to reproduce the issue
