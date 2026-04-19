# Kubernetes & Helm

Deploy Hearth on Kubernetes using the official Helm chart for production-grade scaling, health checks, and ingress management.

## Prerequisites

- A Kubernetes cluster (1.26+)
- [Helm 3+](https://helm.sh/docs/intro/install/) installed locally
- `kubectl` configured to access your cluster
- A container registry with Hearth images built and pushed (see [Building Images](#building-images) below)

## Chart Location

The Helm chart lives in the repository at:

```
deploy/helm/hearth/
```

## Quick Install

```bash
# From the repository root
helm install hearth deploy/helm/hearth -f values.yaml
```

To install into a specific namespace:

```bash
kubectl create namespace hearth
helm install hearth deploy/helm/hearth -f values.yaml -n hearth
```

## Chart Values

The Helm chart is configured through `values.yaml`. Below are the key sections and their defaults.

### API Server

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

### Worker

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

### Web Frontend

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

### Documentation Site

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

### PostgreSQL

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

### Redis

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

### Secrets

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

### File Storage

```yaml
fileStorage:
  size: 10Gi
  storageClass: ""  # Uses cluster default
  accessModes:
    - ReadWriteMany
```

A shared PersistentVolumeClaim for file uploads. Ensure your cluster supports `ReadWriteMany` access mode (e.g., via NFS, EFS, or a CSI driver). Alternatively, configure external object storage (S3, GCS, MinIO).

### Ingress

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

## Ingress Routing

The Helm chart configures ingress rules that route traffic to the appropriate services:

| URL Pattern | Service | Notes |
|---|---|---|
| `hearth.local/` | web | React SPA frontend |
| `hearth.local/api/` | api | REST API endpoints |
| `hearth.local/socket.io/` | api | WebSocket connections |
| `docs.hearth.local/` | docs | Documentation site |

The WebSocket path requires special proxy configuration. The Helm chart includes nginx annotations for connection upgrades and extended timeouts (3600s) by default.

### Custom Host

Override the host in your `values.yaml`:

```yaml
ingress:
  host: hearth.example.com
  docs:
    host: docs.hearth.example.com
```

## TLS Configuration

Enable TLS in your values file and provide a certificate:

```yaml
ingress:
  tls:
    enabled: true
    secretName: hearth-tls
```

### Using cert-manager

If you have [cert-manager](https://cert-manager.io/) installed, add the annotation:

```yaml
ingress:
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    enabled: true
    secretName: hearth-tls
```

### Bringing Your Own Certificate

Create a TLS secret manually:

```bash
kubectl create secret tls hearth-tls \
  --cert=tls.crt \
  --key=tls.key \
  -n hearth
```

## Scaling

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

## Building Images

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

## Upgrading

```bash
# Update chart values
helm upgrade hearth deploy/helm/hearth -f values.yaml -n hearth

# Run database migrations (after pods are running)
kubectl exec -it deploy/hearth-api -n hearth -- npx prisma migrate deploy
```

::: warning
Always run database migrations before or immediately after deploying a new version. Back up the database first. See [Production Checklist](./production) for a safe upgrade procedure.
:::

## Uninstalling

```bash
helm uninstall hearth -n hearth
```

This removes all Kubernetes resources created by the chart. PersistentVolumeClaims are retained by default to prevent data loss. Delete them manually if needed:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=hearth -n hearth
```

## Related

- [Docker Compose](./docker) — Simpler single-node deployment
- [Production Checklist](./production) — Security hardening and operational readiness
- [Monitoring & Health](./monitoring) — Health checks, probes, and alerting
