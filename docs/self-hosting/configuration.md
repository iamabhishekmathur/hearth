# Configuration

Self-hosted Hearth reads configuration from environment variables, usually through `.env`, Compose environment, Kubernetes secrets, or a secret manager.

[[toc]]

## Required Core Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `REDIS_URL` | Redis connection string. |
| `SESSION_SECRET` | Signs session cookies. |
| `ENCRYPTION_KEY` | Encrypts integration credentials. Must be 64 hex characters. |
| `WEB_URL` | Public frontend URL. |
| `API_URL` | Public API URL used for callbacks and redirects. |

## LLM Provider Variables

Set at least one:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic provider key. |
| `OPENAI_API_KEY` | OpenAI provider key. |
| `OLLAMA_BASE_URL` | Local or self-managed Ollama endpoint. |

Additional provider keys can also be saved through the admin UI when supported.

## OAuth and Integration Variables

Optional variables include:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `BRAVE_SEARCH_API_KEY`
- SMTP variables for email delivery.

## Public URLs

In production, `WEB_URL` and `API_URL` must match the externally reachable HTTPS URLs. Incorrect values commonly break OAuth callbacks, SSO callbacks, WebSocket origins, and redirects.

## Validation

The API validates environment variables at startup. If validation fails, the server exits with an error rather than starting with partial configuration.
