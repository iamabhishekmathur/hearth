# Hearth Helm Chart

Kubernetes Helm chart for deploying Hearth, an open-source AI productivity platform for teams. Tuned for 500+ user deployments with horizontal pod autoscaling.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.x
- kubectl configured to your cluster
- nginx Ingress Controller (for ingress)
- A default StorageClass (for PVCs)

## Quick Start

```bash
# Install with default values
helm install hearth ./deploy/helm/hearth

# Install into a specific namespace
helm install hearth ./deploy/helm/hearth --namespace hearth --create-namespace

# Install with custom values
helm install hearth ./deploy/helm/hearth -f my-values.yaml
```

## Configuration

Override any value in `values.yaml` via `--set` or a custom values file.

### Key Configuration Options

| Parameter | Description | Default |
|---|---|---|
| `api.replicaCount` | API server replicas | `2` |
| `api.hpa.maxReplicas` | Max API replicas under load | `10` |
| `worker.replicaCount` | Worker replicas | `1` |
| `worker.hpa.maxReplicas` | Max worker replicas under load | `5` |
| `web.replicaCount` | Web frontend replicas | `2` |
| `ingress.host` | Ingress hostname | `hearth.local` |
| `ingress.tls.enabled` | Enable TLS | `false` |
| `postgres.storage.size` | PostgreSQL storage size | `20Gi` |
| `redis.storage.size` | Redis storage size | `5Gi` |

### Setting Secrets

Always provide real secrets in production:

```bash
helm install hearth ./deploy/helm/hearth \
  --set secrets.encryptionKey="your-64-char-hex-key" \
  --set secrets.sessionSecret="your-session-secret" \
  --set secrets.databaseUrl="postgresql://user:pass@host:5432/hearth" \
  --set postgres.password="strong-password"
```

Or use a values file (never commit to version control):

```yaml
secrets:
  databaseUrl: "postgresql://user:pass@host:5432/hearth"
  encryptionKey: "0123456789abcdef..."
  sessionSecret: "random-session-secret"
```

## Architecture

The chart deploys the following components:

- **API** (Deployment + HPA): Express + Socket.io backend, scales 2-10 pods
- **Worker** (Deployment + HPA): BullMQ job processor, scales 1-5 pods
- **Web** (Deployment): Nginx serving the React/Vite frontend
- **PostgreSQL** (StatefulSet): pgvector-enabled database with persistent storage
- **Redis** (Deployment): Cache and job queue with persistent storage
- **Ingress**: Nginx ingress routing `/api/` and `/socket.io/` to API, `/` to web

## Production Checklist

Before deploying to production:

- [ ] Set real values for `secrets.encryptionKey`, `secrets.sessionSecret`, and `secrets.databaseUrl`
- [ ] Set a strong `postgres.password`
- [ ] Enable TLS: `ingress.tls.enabled=true` and provide a TLS secret
- [ ] Update `ingress.host` to your real domain
- [ ] Update `env.webUrl` to match your domain
- [ ] Consider using an external managed PostgreSQL (set `postgres.enabled=false`, update `secrets.databaseUrl` and `env.redisUrl`)
- [ ] Consider using an external managed Redis (set `redis.enabled=false`, update `env.redisUrl`)
- [ ] Configure appropriate `storageClass` for your cloud provider
- [ ] Set resource limits appropriate for your workload
- [ ] Configure pod disruption budgets for high availability
- [ ] Set up monitoring and alerting

## Upgrading

```bash
helm upgrade hearth ./deploy/helm/hearth -f my-values.yaml
```

## Uninstall

```bash
helm uninstall hearth

# If PVCs should also be removed:
kubectl delete pvc -l app.kubernetes.io/instance=hearth
```

## Troubleshooting

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/instance=hearth

# View API logs
kubectl logs -l app.kubernetes.io/component=api

# View worker logs
kubectl logs -l app.kubernetes.io/component=worker

# Check HPA status
kubectl get hpa
```
