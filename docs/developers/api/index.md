# API Overview

The Hearth API provides programmatic access to all platform features including chat, tasks, memory, skills, routines, activity feeds, artifacts, and administration.

## Base URL

All API endpoints are prefixed with:

```
/api/v1/
```

## Authentication

Hearth uses **session-based authentication** with HTTP-only secure cookies. To establish a session:

1. **Register** a new account via `POST /api/v1/auth/register`
2. **Log in** via `POST /api/v1/auth/login`

Both endpoints set an HTTP-only cookie that is automatically included in subsequent requests. No `Authorization` header is needed.

To end a session:

- `POST /api/v1/auth/logout`

To retrieve the current authenticated user:

- `GET /api/v1/auth/me`

All endpoints (except auth and health) require an active session. Unauthenticated requests receive a `401 Unauthorized` response.

## Error Format

All error responses follow a consistent structure:

```json
{
  "error": "Human-readable error message",
  "details": {}
}
```

The `details` field is optional and included when additional context is available (e.g., validation errors).

### Standard HTTP Status Codes

| Status | Meaning |
|--------|---------|
| `200 OK` | Request succeeded |
| `201 Created` | Resource created successfully |
| `202 Accepted` | Request accepted for async processing |
| `400 Bad Request` | Invalid request body or parameters |
| `401 Unauthorized` | No active session |
| `403 Forbidden` | Insufficient permissions |
| `404 Not Found` | Resource does not exist |
| `409 Conflict` | Resource conflict (e.g., duplicate) |
| `422 Unprocessable Entity` | Validation failed |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected server error |

## Rate Limiting

API requests are rate-limited per session. When the limit is exceeded, the server responds with `429 Too Many Requests`. Rate limit headers are included in every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

## Pagination

### Offset Pagination

Most list endpoints use offset-based pagination with `page` and `pageSize` query parameters.

**Request:**

```
GET /api/v1/tasks?page=2&pageSize=20
```

**Response:**

```json
{
  "data": [...],
  "total": 85,
  "page": 2,
  "pageSize": 20
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number (1-indexed) |
| `pageSize` | number | `20` | Items per page |

### Cursor Pagination

The activity feed uses cursor-based pagination for efficient real-time data access.

**Request:**

```
GET /api/v1/activity?cursor=abc123&limit=50
```

**Response:**

```json
{
  "data": [...],
  "nextCursor": "def456",
  "hasMore": true
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | — | Opaque cursor from previous response |
| `limit` | number | `50` | Items per page |

## Governance (Admin)

All governance endpoints require `admin` role.

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/governance/settings` | Get governance monitoring settings |
| `PUT` | `/admin/governance/settings` | Update governance settings |
| `GET` | `/admin/governance/policies` | List governance policies |
| `POST` | `/admin/governance/policies` | Create a governance policy |
| `GET` | `/admin/governance/policies/:id` | Get a policy |
| `PUT` | `/admin/governance/policies/:id` | Update a policy |
| `DELETE` | `/admin/governance/policies/:id` | Delete a policy |
| `POST` | `/admin/governance/policies/test` | Test a policy against sample text |
| `GET` | `/admin/governance/violations` | List violations (paginated) |
| `GET` | `/admin/governance/violations/:id` | Get violation details |
| `PATCH` | `/admin/governance/violations/:id` | Review a violation |
| `GET` | `/admin/governance/stats` | Violation statistics |
| `GET` | `/admin/governance/export` | Export violations for compliance |

## WebSocket

Real-time events (chat messages, task updates, activity) are delivered over Socket.io. Connect to the same host as the API server. Authentication uses the same session cookie.

### Governance Events

| Event | Payload | Description |
|---|---|---|
| `governance:violation` | `{ violationId, userId, userName, policyName, severity, snippet }` | Governance violation detected (org room) |
| `governance:blocked` | `{ messageId, policyName, severity, reason }` | Message blocked by policy (session room) |
| `governance:warning` | `{ messageId, policyName, reason }` | Message flagged by policy (session room) |
