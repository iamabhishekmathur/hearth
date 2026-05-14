# Troubleshooting

Common self-hosted issues usually come from environment variables, networking, data stores, migrations, provider keys, or integration credentials.

[[toc]]

## App Will Not Start

Check:

1. API logs.
2. Required environment variables.
3. Postgres connectivity.
4. Redis connectivity.
5. `ENCRYPTION_KEY` format.
6. Pending migrations.

## Cannot Reach the App

Check:

- Web service is running.
- API service is running.
- Reverse proxy routes `/api/` to the API.
- Reverse proxy routes `/socket.io/` to the API with WebSocket upgrades.
- `WEB_URL` and `API_URL` match the public URL.
- Browser console for CORS or WebSocket errors.

## Agent Not Responding

Check:

- At least one LLM provider is configured.
- Provider key is valid.
- Worker process is running.
- Redis queues are reachable.
- Provider is not rate-limiting requests.
- Compliance or governance policies are not blocking the request.

## Integrations Failing

Check:

- Credentials are still valid.
- Required scopes are granted.
- The connected account can access the requested workspace, repo, project, calendar, or document.
- Webhook signing secrets and callback URLs match.
- `ENCRYPTION_KEY` has not changed unexpectedly.

## Migrations Failing

Back up first, then check:

- `DATABASE_URL` points to the intended database.
- The database user can run migrations.
- The `vector` extension is installed.
- Existing schema drift from manual changes.

## Slow Performance

Check:

- Worker queue depth.
- LLM provider latency.
- Postgres CPU, memory, and indexes.
- Redis memory and latency.
- Large context items attached to tasks.
- Long-running routines.
