# ChatGPT Plan (Sign in with ChatGPT)

Connect a user's ChatGPT account so their chats spend their ChatGPT plan through OpenAI's Responses API. The routes are only active when the server sets `CHATGPT_PLAN_ENABLED=true`. See [Use Your ChatGPT Plan](/guide/chatgpt-plan).

## Authentication

All `/me/chatgpt-plan` endpoints and `POST /auth/chatgpt/start` require an authenticated session and a CSRF token. The OAuth callback is unauthenticated by design; it is bound to the user by a single-use `state` stored server-side.

## Endpoints

### POST /api/v1/auth/chatgpt/start

Begins OAuth 2.0 authorization code + PKCE (S256). Returns the ChatGPT authorize URL to navigate to.

**Response:** `200 OK`

```json
{ "data": { "url": "https://auth.openai.com/api/accounts/authorize?..." } }
```

`404` with `code: "not_enabled"` when the feature is off.

### GET /api/v1/auth/chatgpt/callback

OAuth redirect target. Validates `state`, exchanges the code, verifies the ID token (issuer, audience, expiry, nonce, RS256 signature via JWKS), requires the `chatgpt.tokens.use.direct` scope, and stores encrypted tokens. Then it redirects to `WEB_URL/?chatgpt=<result>#/settings/ai-plan`, where `result` is `connected`, `access_denied`, `plan_not_granted`, `account_mismatch`, `invalid_state`, `invalid_id_token`, or `token_exchange_failed`.

### GET /api/v1/me/chatgpt-plan

Connection status.

```json
{
  "data": {
    "enabled": true,
    "mode": "open_source",
    "connected": true,
    "status": "active",
    "accountEmail": "me@example.com",
    "useForChat": true,
    "defaultModel": null,
    "welcomeAcknowledged": false,
    "lastUsageLimitAt": null,
    "manageUsageUrl": "https://chatgpt.com/#settings/Security",
    "helpUrl": "https://help.openai.com/..."
  }
}
```

`status` is `active`, `needs_reauth`, or `plan_unavailable`. `mode` is `open_source` (dynamic client registration, `127.0.0.1` redirect) or `hosted` (`CHATGPT_CLIENT_ID` set).

### PATCH /api/v1/me/chatgpt-plan

| Field | Type | Description |
|---|---|---|
| `useForChat` | boolean | Route this user's chats through their plan. |
| `defaultModel` | string \| null | Plan model slug from `GET /models`; `null` = first available. |
| `acknowledgeWelcome` | `true` | Record that the first-use disclosure was shown. |

Returns the updated status. `404` with `code: "not_connected"` if no connection exists.

### GET /api/v1/me/chatgpt-plan/models

Models available to the connected account (OpenAI `GET /v1/models`, entries with `visibility: "list"`).

```json
{ "data": [{ "id": "gpt-6.1-sol", "displayName": "GPT-6.1 Sol" }] }
```

### DELETE /api/v1/me/chatgpt-plan

Revokes the refresh token at OpenAI (best effort) and deletes the stored credential.

## Sending Messages on the Plan

`POST /api/v1/chat/sessions/:id/messages` accepts `providerId: "chatgpt-plan"` with a plan `model`. If the user has `useForChat` on and sends no `model`/`providerId`, the run uses their plan automatically. An explicit choice of another model always wins.

Plan runs never fall back to the org's API key. Failures stream as `error` events with a `code`:

| Code | Meaning | Suggested UI |
|---|---|---|
| `chatgpt_plan_usage_limit` | Plan or per-app cap reached | **Manage usage** (primary) |
| `chatgpt_plan_unavailable` | Plan usage unavailable for this account | Explain, offer org models |
| `chatgpt_plan_reauth` | Tokens expired or revoked | **Reconnect** |
| `chatgpt_plan_not_connected` | No connection | **Continue with ChatGPT** |
