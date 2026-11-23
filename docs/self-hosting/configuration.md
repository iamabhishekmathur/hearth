# Configuration

Self-hosted Hearth reads configuration from environment variables, usually through `.env`, Compose environment, Kubernetes secrets, or a secret manager.

[[toc]]

## Required Core Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `REDIS_URL` | Redis connection string. |
| `SESSION_SECRET` | Signs session cookies. At least 32 characters in production. |
| `ENCRYPTION_KEY` | Encrypts integration credentials and stored LLM tokens. Must be 64 hex characters. |
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

## ChatGPT Plan Variables

Let each user connect their own ChatGPT plan ([guide](/guide/chatgpt-plan)). Off by default.

| Variable | Purpose |
|---|---|
| `CHATGPT_PLAN_ENABLED` | `true` to enable Sign in with ChatGPT plan usage. Without `CHATGPT_CLIENT_ID`, it only turns on when `WEB_URL` is `localhost` or `127.0.0.1` (OpenAI's open-source flow); on a remote host Hearth keeps it off and logs why. |
| `CHATGPT_CLIENT_ID` | Static client id for OpenAI-approved hosted deployments. Unset = open-source dynamic registration. Requires `CHATGPT_REDIRECT_URI`. |
| `CHATGPT_REDIRECT_URI` | OAuth redirect URI. Defaults to `http://127.0.0.1:<API_PORT>/api/v1/auth/chatgpt/callback`; OpenAI's open-source flow only accepts a `127.0.0.1` loopback URI. |
| `CHATGPT_AUTH_BASE_URL` | Defaults to `https://auth.openai.com`. |
| `CHATGPT_API_BASE_URL` | Defaults to `https://api.openai.com/v1`. |

Under OpenAI's self-serve terms, plan usage is for open-source apps running locally or on a self-hosted machine. Paid or remotely hosted offerings must be approved by OpenAI first.

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
- `SSO_CALLBACK_SECRET`: required to enable `POST /api/v1/auth/sso/callback`. See [SSO](/admin/sso).

## Public URLs

In production, `WEB_URL` and `API_URL` must match the externally reachable HTTPS URLs. Incorrect values commonly break OAuth callbacks, SSO callbacks, WebSocket origins, and redirects.

## Validation

The API validates environment variables at startup. If validation fails, the server exits with an error rather than starting with partial configuration.

With `NODE_ENV=production`, the API also refuses to start if `ENCRYPTION_KEY` is the all-zero development default or not 64 hex characters, or if `SESSION_SECRET` is the development default or shorter than 32 characters. The bundled `docker-compose.yml` no longer has fallback secrets; set both in `.env`:

```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
```
