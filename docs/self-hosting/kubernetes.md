# Kubernetes and Helm

Use Kubernetes when you need horizontal scaling, managed ingress, production health checks, and independent API/worker scaling.

[[toc]]

## Chart Location

The Helm chart lives in:

```text
deploy/helm/hearth/
```

## Prerequisites

- Kubernetes 1.26+.
- Helm 3+.
- `kubectl` configured for the target cluster.
- A container registry with Hearth images.
- A storage class for persistent volumes if using in-cluster Postgres, Redis, or file storage.

## Basic Install

```bash
kubectl create namespace hearth
helm install hearth deploy/helm/hearth -n hearth -f values.yaml
```

For production, create an environment-specific values file instead of relying on defaults.

## External Data Stores

For production, consider external managed Postgres and Redis:

```bash
helm install hearth deploy/helm/hearth -n hearth \
  --set postgres.enabled=false \
  --set secrets.databaseUrl="postgresql://user:pass@db.example.com:5432/hearth" \
  --set redis.enabled=false \
  --set env.redisUrl="redis://redis.example.com:6379"
```

## Ingress

Route:

- `/` to the web service.
- `/api/` to the API service.
- `/socket.io/` to the API service with WebSocket upgrades enabled.

Enable TLS before production use.

## Scaling

Scale API and workers independently. Workers handle background jobs such as routines, memory synthesis, work intake, task planning, and task execution.

## Upgrades

```bash
helm upgrade hearth deploy/helm/hearth -n hearth -f values.yaml
kubectl exec -n hearth deploy/hearth-api -- npx prisma migrate deploy
```

Back up Postgres before migrations.
