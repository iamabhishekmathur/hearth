# Backups and Upgrades

Backups and upgrades are self-hosted operator responsibilities.

[[toc]]

## What to Back Up

| Data | Why it matters |
|---|---|
| Postgres | Users, sessions, tasks, memory, skills, routines, audit logs, integrations, decisions, and configuration. |
| File storage | Uploads, attachments, artifacts, and task context files. |
| Deployment config | Values files, environment variables, and secret references. |

Redis usually stores queues, sessions, cache, and pub/sub state. Decide whether Redis persistence matters for your recovery goals.

## Postgres Backup

For Docker Compose:

```bash
docker compose exec postgres pg_dump -U hearth hearth > backup.sql
```

Restore:

```bash
docker compose exec -T postgres psql -U hearth hearth < backup.sql
```

For production, schedule automated backups and regularly test restore.

## Upgrade Flow

1. Read release notes.
2. Back up Postgres and file storage.
3. Deploy new web, API, and worker images.
4. Run Prisma migrations.
5. Confirm the API health endpoint.
6. Watch worker logs and queue health.
7. Smoke-test chat, tasks, routines, integrations, and admin settings.

## Migration Command

```bash
npx prisma migrate deploy
```

Run migrations with the same database URL used by the API.
