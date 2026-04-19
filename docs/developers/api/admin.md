# Admin Endpoints

Administration endpoints for managing LLM configuration, users, teams, integrations, analytics, audit logs, authentication, identity files, and system health.

## Authentication

All `/admin/*` endpoints require an authenticated session with the `admin` role. Auth endpoints (`/auth/*`) and the health endpoint are public.

## Endpoints

### LLM Configuration

#### GET /api/v1/admin/llm-config

Get the current LLM configuration, including active provider, model, and parameters.

**Response:** `200 OK`

```json
{
  "data": {
    "activeProviderId": "openai",
    "activeModel": "gpt-4o",
    "temperature": 0.7,
    "maxTokens": 4096,
    "providers": [
      {
        "id": "openai",
        "name": "OpenAI",
        "enabled": true,
        "models": ["gpt-4o", "gpt-4o-mini"]
      },
      {
        "id": "ollama",
        "name": "Ollama",
        "enabled": false,
        "models": ["llama3", "mistral"]
      }
    ]
  }
}
```

---

#### PUT /api/v1/admin/llm-config

Update the LLM configuration.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activeProviderId` | string | No | Provider to use |
| `activeModel` | string | No | Model to use |
| `temperature` | number | No | Sampling temperature (0.0-2.0) |
| `maxTokens` | number | No | Maximum tokens per response |

**Response:** `200 OK`

```json
{
  "data": {
    "activeProviderId": "openai",
    "activeModel": "gpt-4o",
    "temperature": 0.5,
    "maxTokens": 8192
  }
}
```

---

#### GET /api/v1/admin/llm-config/providers

List all available LLM providers and their status.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "openai",
      "name": "OpenAI",
      "enabled": true,
      "hasApiKey": true,
      "models": ["gpt-4o", "gpt-4o-mini"]
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "enabled": true,
      "hasApiKey": true,
      "models": ["claude-sonnet-4-20250514"]
    },
    {
      "id": "ollama",
      "name": "Ollama",
      "enabled": false,
      "hasApiKey": false,
      "models": ["llama3", "mistral"]
    }
  ]
}
```

---

#### GET /api/v1/admin/llm-config/embedding

Get the current embedding model configuration.

**Response:** `200 OK`

```json
{
  "data": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimension": 1536
  }
}
```

---

#### POST /api/v1/admin/llm-config/keys

Set or update an API key for a provider. Keys are encrypted with AES-256-GCM before storage.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerId` | string | Yes | Provider ID |
| `apiKey` | string | Yes | API key value |

**Response:** `200 OK`

```json
{
  "data": { "saved": true }
}
```

---

### User Management

#### GET /api/v1/admin/users

List all users with optional filtering.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Page number (default: `1`) |
| `pageSize` | number | No | Items per page (default: `20`) |
| `teamId` | string | No | Filter by team membership |
| `role` | string | No | Filter by role (`"user"`, `"admin"`) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "user_abc",
      "displayName": "Alice",
      "email": "alice@example.com",
      "role": "admin",
      "teamIds": ["team_001"],
      "createdAt": "2026-03-01T10:00:00Z",
      "lastActiveAt": "2026-04-17T09:00:00Z"
    }
  ],
  "total": 25,
  "page": 1,
  "pageSize": 20
}
```

---

#### PATCH /api/v1/admin/users/:id

Update a user's profile or role.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | User ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `displayName` | string | No | Updated display name |
| `role` | string | No | Updated role (`"user"` or `"admin"`) |
| `teamIds` | string[] | No | Updated team memberships |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "user_abc",
    "displayName": "Alice",
    "email": "alice@example.com",
    "role": "admin",
    "teamIds": ["team_001", "team_002"],
    "createdAt": "2026-03-01T10:00:00Z",
    "lastActiveAt": "2026-04-17T09:00:00Z"
  }
}
```

---

#### DELETE /api/v1/admin/users/:id

Delete a user account.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | User ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

### Team Management

#### GET /api/v1/admin/teams

List all teams.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "team_001",
      "name": "Engineering",
      "memberCount": 8,
      "createdAt": "2026-03-01T10:00:00Z"
    }
  ]
}
```

---

#### POST /api/v1/admin/teams

Create a new team.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Team name |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "team_002",
    "name": "Design",
    "memberCount": 0,
    "createdAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### PATCH /api/v1/admin/teams/:id

Update a team.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Team ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Updated team name |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "team_002",
    "name": "Design & UX",
    "memberCount": 0,
    "createdAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### DELETE /api/v1/admin/teams/:id

Delete a team.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Team ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

### Integrations

#### GET /api/v1/admin/integrations

List all configured integrations.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "integration_001",
      "provider": "github",
      "name": "GitHub - hearth-org",
      "status": "connected",
      "createdAt": "2026-03-15T14:00:00Z"
    },
    {
      "id": "integration_002",
      "provider": "slack",
      "name": "Slack - Hearth Workspace",
      "status": "connected",
      "createdAt": "2026-03-20T09:00:00Z"
    }
  ]
}
```

---

#### POST /api/v1/admin/integrations

Add a new integration.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | Integration provider (e.g., `"github"`, `"slack"`, `"jira"`) |
| `name` | string | Yes | Display name |
| `config` | object | Yes | Provider-specific configuration |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "integration_003",
    "provider": "jira",
    "name": "Jira - Hearth Project",
    "status": "pending",
    "createdAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### PATCH /api/v1/admin/integrations/:id

Update an integration.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Integration ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Updated display name |
| `config` | object | No | Updated configuration |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "integration_003",
    "provider": "jira",
    "name": "Jira - Hearth Core",
    "status": "connected",
    "createdAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### DELETE /api/v1/admin/integrations/:id

Remove an integration.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Integration ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

#### GET /api/v1/admin/integrations/:id/health

Check the health status of an integration.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Integration ID |

**Response:** `200 OK`

```json
{
  "data": {
    "status": "healthy",
    "latency": 120,
    "lastChecked": "2026-04-17T10:00:00Z",
    "details": {
      "apiReachable": true,
      "tokenValid": true,
      "rateLimit": {
        "remaining": 4800,
        "limit": 5000,
        "resetsAt": "2026-04-17T11:00:00Z"
      }
    }
  }
}
```

---

### Analytics

#### GET /api/v1/admin/analytics

Get platform usage analytics.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `days` | number | No | Number of days to include (default varies) |

**Response:** `200 OK`

```json
{
  "data": {
    "period": {
      "from": "2026-04-10T00:00:00Z",
      "to": "2026-04-17T00:00:00Z"
    },
    "users": {
      "total": 25,
      "activeThisPeriod": 18
    },
    "chat": {
      "sessionsCreated": 142,
      "messagesSent": 2340
    },
    "tasks": {
      "created": 56,
      "completed": 41
    },
    "routines": {
      "executed": 87,
      "successRate": 0.94
    },
    "llm": {
      "totalTokens": 1250000,
      "totalRequests": 890
    }
  }
}
```

---

### Routine Health (Admin)

#### GET /api/v1/admin/routines

List all routines in the organization, across all scopes.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "routine_abc123",
      "name": "Daily Standup Summary",
      "scope": "team",
      "enabled": true,
      "schedule": "0 9 * * 1-5",
      "lastRunAt": "2026-04-18T09:00:00Z",
      "user": { "id": "user_abc", "name": "Alice", "email": "alice@example.com" }
    }
  ]
}
```

---

#### GET /api/v1/admin/routines/analytics

Get aggregated analytics for all routines in the organization.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | string (ISO date) | No | Start date for the analytics period |
| `to` | string (ISO date) | No | End date for the analytics period |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "routineId": "routine_abc123",
      "routineName": "Daily Standup Summary",
      "totalRuns": 45,
      "successCount": 42,
      "failedCount": 3,
      "successRate": 93.3,
      "avgDurationMs": 4500,
      "totalTokens": 125000,
      "lastRunAt": "2026-04-18T09:00:00Z"
    }
  ]
}
```

---

#### GET /api/v1/admin/routines/analytics/top-consumers

Get routines ranked by token consumption.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Number of results (default: `10`) |

**Response:** `200 OK`

Same format as analytics response, sorted by `totalTokens` descending.

---

#### GET /api/v1/admin/routines/alerts

List health alerts for the organization.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "alert_001",
      "orgId": "org_abc",
      "routineId": "routine_abc123",
      "alertType": "consecutive_failures",
      "threshold": { "count": 3 },
      "enabled": true,
      "lastFiredAt": "2026-04-17T15:00:00Z",
      "createdAt": "2026-04-10T10:00:00Z",
      "routine": { "id": "routine_abc123", "name": "Daily Standup Summary" }
    }
  ]
}
```

---

#### POST /api/v1/admin/routines/alerts

Create a health alert.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `routineId` | string | Yes | Routine to monitor |
| `alertType` | string | Yes | `"consecutive_failures"`, `"missed_schedule"`, or `"high_cost"` |
| `threshold` | object | Yes | Alert-specific threshold (e.g., `{ "count": 3 }`, `{ "hours": 24 }`, `{ "tokens": 100000 }`) |

**Response:** `201 Created`

---

#### DELETE /api/v1/admin/routines/alerts/:id

Delete a health alert.

**Response:** `204 No Content`

---

### Audit Logs

#### GET /api/v1/admin/audit-logs

List audit log entries with optional filtering.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | No | Filter by user |
| `action` | string | No | Filter by action type |
| `entityType` | string | No | Filter by entity type |
| `page` | number | No | Page number (default: `1`) |
| `pageSize` | number | No | Items per page (default: `20`) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "audit_001",
      "userId": "user_abc",
      "userName": "Alice",
      "action": "user.role_changed",
      "entityType": "user",
      "entityId": "user_def",
      "metadata": {
        "oldRole": "user",
        "newRole": "admin"
      },
      "ipAddress": "192.168.1.1",
      "createdAt": "2026-04-17T08:00:00Z"
    }
  ],
  "total": 340,
  "page": 1,
  "pageSize": 20
}
```

---

### Authentication

These endpoints are public (no session required for register/login).

#### POST /api/v1/auth/register

Register a new user account.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Email address |
| `password` | string | Yes | Password (minimum 8 characters) |
| `displayName` | string | Yes | Display name |

**Response:** `201 Created`

Sets an HTTP-only session cookie.

```json
{
  "data": {
    "id": "user_new789",
    "email": "bob@example.com",
    "displayName": "Bob",
    "role": "user",
    "createdAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### POST /api/v1/auth/login

Log in with existing credentials.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Email address |
| `password` | string | Yes | Password |

**Response:** `200 OK`

Sets an HTTP-only session cookie.

```json
{
  "data": {
    "id": "user_abc",
    "email": "alice@example.com",
    "displayName": "Alice",
    "role": "admin",
    "createdAt": "2026-03-01T10:00:00Z"
  }
}
```

---

#### POST /api/v1/auth/logout

End the current session.

**Response:** `200 OK`

Clears the session cookie.

```json
{
  "data": { "loggedOut": true }
}
```

---

#### GET /api/v1/auth/me

Get the currently authenticated user.

**Response:** `200 OK`

```json
{
  "data": {
    "id": "user_abc",
    "email": "alice@example.com",
    "displayName": "Alice",
    "role": "admin",
    "teamIds": ["team_001"],
    "createdAt": "2026-03-01T10:00:00Z"
  }
}
```

---

### Identity

#### GET /api/v1/identity/:level/:fileType

Get an identity file for a specific level.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | string | Identity level (e.g., `"org"`, `"team"`, `"user"`) |
| `fileType` | string | File type identifier |

**Response:** `200 OK`

```json
{
  "data": {
    "level": "org",
    "fileType": "personality",
    "content": "You are a helpful assistant for Acme Corp..."
  }
}
```

---

#### PUT /api/v1/identity/:level/:fileType

Update an identity file.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | string | Identity level |
| `fileType` | string | File type identifier |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Identity file content |

**Response:** `200 OK`

```json
{
  "data": {
    "level": "org",
    "fileType": "personality",
    "content": "You are a professional assistant for Acme Corp...",
    "updatedAt": "2026-04-17T10:00:00Z"
  }
}
```

---

### Health

#### GET /api/v1/health

Check API server health. No authentication required.

**Response:** `200 OK`

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "services": {
    "database": "connected",
    "redis": "connected",
    "llm": "available"
  }
}
```

### Compliance Packs

#### GET /api/v1/admin/compliance/packs

List all available compliance packs with their detectors. Six built-in packs: `pii`, `pci-dss`, `phi`, `gdpr`, `ferpa`, `financial`.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "pii",
      "name": "PII (Personally Identifiable Information)",
      "description": "Detects and scrubs SSNs, email addresses, phone numbers, person names, addresses, and dates of birth.",
      "category": "privacy",
      "detectorCount": 6,
      "detectors": [
        { "id": "pii.SSN", "name": "Social Security Number", "entityType": "SSN" },
        { "id": "pii.EMAIL", "name": "Email Address", "entityType": "EMAIL" }
      ]
    }
  ]
}
```

---

#### GET /api/v1/admin/compliance/config

Get the organization's current compliance configuration.

**Response:** `200 OK`

```json
{
  "data": {
    "enabledPacks": ["pii", "pci-dss"],
    "detectorOverrides": { "pii.EMAIL": { "enabled": false } },
    "auditLevel": "summary",
    "allowUserOverride": false
  }
}
```

---

#### PUT /api/v1/admin/compliance/config

Update compliance configuration. Changes take effect immediately (cache is invalidated on save).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabledPacks` | string[] | No | Pack IDs to enable |
| `detectorOverrides` | object | No | Per-detector overrides, e.g. `{ "pii.EMAIL": { "enabled": false } }` |
| `auditLevel` | string | No | `"summary"` or `"detailed"` |
| `allowUserOverride` | boolean | No | Allow `<safe>` tag bypass |

**Response:** `200 OK`

```json
{
  "data": {
    "enabledPacks": ["pii", "pci-dss"],
    "detectorOverrides": {},
    "auditLevel": "detailed",
    "allowUserOverride": false
  },
  "message": "Compliance configuration updated"
}
```

---

#### POST /api/v1/admin/compliance/test

Dry-run scrubbing on sample text.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Sample text to scrub |
| `packIds` | string[] | Yes | Pack IDs to test against |

**Response:** `200 OK`

```json
{
  "data": {
    "scrubbedText": "SSN: [SSN_1], Card: [CREDIT_CARD_1]",
    "entitiesFound": 2,
    "entities": [
      { "type": "SSN", "original": "123-45-6789", "placeholder": "[SSN_1]" },
      { "type": "CREDIT_CARD", "original": "4111-1111-1111-1111", "placeholder": "[CREDIT_CARD_1]" }
    ]
  }
}
```

---

#### GET /api/v1/admin/compliance/stats

Scrubbing statistics for the last 30 days.

**Response:** `200 OK`

```json
{
  "data": {
    "totalScrubs": 1247,
    "entityCounts": { "SSN": 89, "EMAIL": 342, "PHONE": 156 },
    "packUsage": { "pii": 1100, "pci-dss": 147 },
    "period": "last_30_days"
  }
}
```

---

### Cognitive Profiles (Digital Co-Worker)

#### GET /api/v1/admin/cognitive/settings

Get the organization's cognitive profile settings.

**Response:** `200 OK`

```json
{
  "data": {
    "enabled": false
  }
}
```

---

#### PUT /api/v1/admin/cognitive/settings

Enable or disable cognitive profiles for the organization.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | Whether to enable cognitive profiles |

**Response:** `200 OK`

```json
{
  "message": "Cognitive profile settings updated"
}
```

---

## Types

```typescript
interface User {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  teamIds?: string[];
  createdAt: string;
  lastActiveAt?: string;
}

interface Team {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

interface Integration {
  id: string;
  provider: string;
  name: string;
  status: "pending" | "connected" | "error";
  config?: Record<string, any>;
  createdAt: string;
}

interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, any>;
  ipAddress: string;
  createdAt: string;
}

interface LlmConfig {
  activeProviderId: string;
  activeModel: string;
  temperature: number;
  maxTokens: number;
}

interface LlmProvider {
  id: string;
  name: string;
  enabled: boolean;
  hasApiKey?: boolean;
  models: string[];
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  services: Record<string, string>;
}
```
