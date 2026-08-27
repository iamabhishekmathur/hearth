# Hearth backend on AWS (OpenTofu)

Provisions the Hearth application backend (API + worker) on ECS Fargate, with
RDS Postgres (pgvector), ElastiCache Redis, and an ALB. The existing S3 +
CloudFront frontend at `hearth-app.xyz` is routed to this backend by adding
`/api/*`, `/ws/*`, `/socket.io/*` behaviors to the existing distribution
(same-origin, so sessions/CSRF cookies and WebSockets work with no frontend
rebuild). State lives in `s3://hearth-cloud-tfstate-633065023981`.

## Architecture

```
                       hearth-app.xyz (Route53)
                                │
                     CloudFront E1O2U9YQ6WTPX3
              ┌──────────────────┴───────────────────┐
        default behavior                        /api/*  /ws/*  /socket.io/*
              │                                        │
      S3 landing bucket                        ALB (:80, CloudFront-only SG)
                                                       │  target group :8000
                                              ECS Fargate (ARM64)
                                              ├── api    (node dist/index.js)
                                              └── worker (node dist/worker.js)
                                                       │
                                   ┌───────────────────┴──────────────┐
                            RDS Postgres 16 (pgvector)        ElastiCache Redis 7
```

## Deploy

```bash
# 1. Provision infra
tofu init
tofu plan -out=tfplan
tofu apply tfplan

# 2. Build + push the API image (api and worker share it)
ECR=$(tofu output -raw ecr_repository_url)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "${ECR%/*}"
docker buildx build --platform linux/arm64 -f ../../apps/api/Dockerfile -t "$ECR:latest" --push ../..

# 3. Run DB migrations (RDS is reachable from the admin IP in variables.tf)
DATABASE_URL=$(tofu output -raw database_url) \
  pnpm --dir ../../apps/api exec prisma migrate deploy

# 4. Roll the services onto the pushed image
aws ecs update-service --cluster hearth --service hearth-api    --force-new-deployment
aws ecs update-service --cluster hearth --service hearth-worker --force-new-deployment

# 5. Point CloudFront at the ALB
python3 cloudfront-patch.py E1O2U9YQ6WTPX3 "$(tofu output -raw alb_dns_name)"
```

## Notes / deferred

- **Code-execution sandbox** (`apps/api/src/sandbox/*`, dockerode) is not wired
  up — Fargate has no Docker daemon. Needs an EC2/Firecracker exec host as a
  follow-up. Everything else (auth, chat, routines, onboarding, growth loops)
  runs.
- **LLM keys**: set `anthropic_api_key` / `openai_api_key` in `terraform.tfvars`,
  re-apply, then force a new deployment to enable AI features.
- **File uploads** land on the task's ephemeral disk and are lost on redeploy.
  Add EFS or move storage to S3 for durability.
- `terraform.tfvars` holds generated secrets and is gitignored.
