# Configuration

Hearth uses environment variables for all configuration. Variables are validated at startup using Zod schemas — the API server will refuse to start if required variables are missing or malformed.

Copy `.env.example` to `.env` in the project root. The API server loads this file automatically.

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://hearth:hearth@localhost:5432/hearth` | PostgreSQL connection string. Must point to a database with the pgvector extension enabled. |

The connection string format is:
```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

For production, use SSL:
```
postgresql://hearth:password@db.example.com:5432/hearth?sslmode=require
```

## Redis

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL. Used for session store, BullMQ job queues, WebSocket pub/sub, and rate limiting. |

For Redis with authentication:
```
redis://:password@redis.example.com:6379
```

## Security

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | Yes | `dev-session-secret` | Secret for signing session cookies. Must be a strong random string in production. |
| `ENCRYPTION_KEY` | Yes | `0000...` (64 zeros) | 256-bit hex key for AES-256-GCM encryption of integration tokens. Generate with `openssl rand -hex 32`. |

::: danger
The default values for `SESSION_SECRET` and `ENCRYPTION_KEY` are insecure and only suitable for local development. Always generate unique values for production deployments.
:::

### Generating Secure Keys

```bash
# Session secret (any random string)
openssl rand -base64 32

# Encryption key (must be exactly 64 hex characters = 32 bytes)
openssl rand -hex 32
```

## LLM Providers

Hearth is provider-agnostic. Configure one or more LLM providers. At least one is required for the agent to function.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | — | API key for Claude models (claude-sonnet, claude-opus). Get one at [console.anthropic.com](https://console.anthropic.com). |
| `OPENAI_API_KEY` | No | — | API key for GPT models (gpt-4o, gpt-4-turbo). Get one at [platform.openai.com](https://platform.openai.com). |
| `OLLAMA_BASE_URL` | No | — | Base URL for a local Ollama instance (e.g., `http://localhost:11434`). Enables local model inference with no API key needed. |

The admin dashboard lets organization admins configure which providers are available and set the default model per team. Users can override the model in their personal settings.

## OAuth Providers

### Google

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID for sign-in and Google Workspace integrations. |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret. |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:8000/api/v1/auth/oauth/google/callback` | OAuth callback URL. Update for production domains. |

To set up Google OAuth:

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or select an existing one)
3. Navigate to APIs & Services > Credentials
4. Create an OAuth 2.0 Client ID (Web application type)
5. Add authorized redirect URIs: `https://your-domain.com/api/v1/auth/oauth/google/callback`
6. Copy the Client ID and Client Secret to your `.env`

### Slack

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_CLIENT_ID` | No | — | Slack app client ID for OAuth and the Slack connector. |
| `SLACK_CLIENT_SECRET` | No | — | Slack app client secret. |
| `SLACK_SIGNING_SECRET` | No | — | Signing secret for verifying Slack webhook requests. |

To set up Slack:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under OAuth & Permissions, add scopes: `channels:read`, `chat:write`, `users:read`
3. Install the app to your workspace
4. Copy the Client ID, Client Secret, and Signing Secret to your `.env`

## General

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Environment mode. One of: `development`, `production`, `test`. |
| `API_PORT` | No | `8000` | Port for the Express API server. |
| `API_URL` | No | `http://localhost:8000` | Public URL of the API server. Used for OAuth callbacks and CORS. |
| `WEB_URL` | No | `http://localhost:3000` | Public URL of the frontend. Used for CORS origin and redirect URLs. |

## Environment Variable Validation

Hearth validates all environment variables at startup using Zod. If validation fails, the server logs the specific errors and exits:

```
Invalid environment variables: {
  ENCRYPTION_KEY: ["String must contain exactly 64 character(s)"]
}
```

This fail-fast behavior prevents the server from running with misconfigured values that could cause subtle bugs or security issues.

## Production Checklist

Before deploying to production, verify:

- [ ] `SESSION_SECRET` is a unique, randomly generated string
- [ ] `ENCRYPTION_KEY` is a unique 64-character hex string
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] `REDIS_URL` uses authentication if exposed to a network
- [ ] `WEB_URL` and `API_URL` point to your production domains
- [ ] `GOOGLE_CALLBACK_URL` is updated for your production domain
- [ ] `NODE_ENV` is set to `production`
- [ ] At least one LLM provider API key is configured
