# Routines

Routines are automated workflows that run on schedules, in response to triggers, or on demand. They can be chained together, connected to external integrations, and maintain persistent state between executions.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

### Core

#### GET /api/v1/routines

List routines.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | No | Filter by scope: `"user"`, `"team"`, or `"org"` |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "routine_abc123",
      "name": "Daily Standup Summary",
      "description": "Summarizes team activity from the past 24 hours",
      "scope": "team",
      "enabled": true,
      "schedule": "0 9 * * 1-5",
      "lastRunAt": "2026-04-17T09:00:00Z",
      "createdAt": "2026-04-01T10:00:00Z",
      "updatedAt": "2026-04-17T09:00:05Z"
    }
  ]
}
```

---

#### GET /api/v1/routines/:id

Get a single routine with full details.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "routine_abc123",
    "name": "Daily Standup Summary",
    "description": "Summarizes team activity from the past 24 hours",
    "prompt": "Summarize all task updates, commits, and messages from the last 24 hours for the team.",
    "scope": "team",
    "enabled": true,
    "schedule": "0 9 * * 1-5",
    "triggers": [],
    "chains": [],
    "lastRunAt": "2026-04-17T09:00:00Z",
    "createdAt": "2026-04-01T10:00:00Z",
    "updatedAt": "2026-04-17T09:00:05Z"
  }
}
```

---

#### POST /api/v1/routines

Create a new routine.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Routine name |
| `description` | string | No | Description of what the routine does |
| `prompt` | string | Yes | Prompt text executed by the agent. Supports `{{param}}` templates. |
| `scope` | string | No | `"personal"`, `"team"`, or `"org"` (default: `"personal"`) |
| `schedule` | string | No | Cron expression (5-field). Omit for event-only routines. |
| `stateConfig` | object | No | `{ previousRunCount?: number, trackDeltas?: boolean, maxContextChars?: number }` |
| `parameters` | array | No | Parameter schema: `[{ name, type, label, required, default?, options? }]` |
| `checkpoints` | array | No | Approval checkpoints: `[{ name, description?, position, approverPolicy, timeoutMinutes? }]` |
| `delivery` | object | No | `{ channels: [...], rules?: DeliveryRule[] }` |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "routine_new456",
    "name": "Weekly Report",
    "description": "Generates a weekly progress report",
    "prompt": "Generate a summary of this week's completed tasks and blockers.",
    "scope": "user",
    "enabled": true,
    "schedule": "0 17 * * 5",
    "lastRunAt": null,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### PATCH /api/v1/routines/:id

Update a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Updated name |
| `description` | string | No | Updated description |
| `prompt` | string | No | Updated prompt (supports `{{param}}` templates) |
| `scope` | string | No | Updated scope: `"personal"`, `"team"`, `"org"` |
| `schedule` | string | No | Updated cron schedule |
| `enabled` | boolean | No | Enable or disable |
| `stateConfig` | object | No | Updated state configuration |
| `state` | object | No | Directly set the persistent state |
| `parameters` | array | No | Updated parameter schema |
| `checkpoints` | array | No | Updated approval checkpoints |
| `delivery` | object | No | Updated delivery configuration with optional rules |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "routine_new456",
    "name": "Weekly Report",
    "description": "Generates a comprehensive weekly progress report",
    "prompt": "Generate a detailed summary of this week's work.",
    "scope": "user",
    "enabled": true,
    "schedule": "0 17 * * 5",
    "lastRunAt": null,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:05:00Z"
  }
}
```

---

#### DELETE /api/v1/routines/:id

Delete a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

#### POST /api/v1/routines/:id/toggle

Toggle a routine's enabled state.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "routine_abc123",
    "enabled": false,
    "updatedAt": "2026-04-17T10:10:00Z"
  }
}
```

---

#### POST /api/v1/routines/:id/run-now

Trigger an immediate execution of a routine, regardless of its schedule.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Request Body (optional):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parameterValues` | object | No | Key-value pairs for parameterized routines (e.g., `{ "repo": "hearth", "days": 7 }`) |

**Response:** `202 Accepted`

```json
{
  "data": {
    "runId": "run_xyz789",
    "status": "queued",
    "queuedAt": "2026-04-17T10:15:00Z"
  }
}
```

---

### State

#### GET /api/v1/routines/:id/state

Get the persistent state for a routine. State is preserved between executions.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Response:** `200 OK`

```json
{
  "data": {
    "lastProcessedDate": "2026-04-16",
    "reportCount": 15,
    "customData": {}
  }
}
```

---

#### PUT /api/v1/routines/:id/state

Replace the persistent state for a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Request Body:**

Any valid JSON object to store as the routine's state.

```json
{
  "lastProcessedDate": "2026-04-17",
  "reportCount": 16,
  "customData": { "flag": true }
}
```

**Response:** `200 OK`

```json
{
  "data": {
    "lastProcessedDate": "2026-04-17",
    "reportCount": 16,
    "customData": { "flag": true }
  }
}
```

---

#### DELETE /api/v1/routines/:id/state

Reset the persistent state for a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Response:** `200 OK`

```json
{
  "data": { "cleared": true }
}
```

---

### Run History

#### GET /api/v1/routines/:id/runs

Get execution history for a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Page number (default: `1`) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "run_001",
      "status": "completed",
      "output": "Generated standup summary for 2026-04-17",
      "duration": 4500,
      "startedAt": "2026-04-17T09:00:00Z",
      "completedAt": "2026-04-17T09:00:04Z"
    },
    {
      "id": "run_002",
      "status": "failed",
      "output": null,
      "error": "Timeout exceeded",
      "duration": 30000,
      "startedAt": "2026-04-16T09:00:00Z",
      "completedAt": "2026-04-16T09:00:30Z"
    }
  ],
  "total": 25,
  "page": 1,
  "pageSize": 20
}
```

---

### Triggers

#### GET /api/v1/routines/:id/triggers

List triggers attached to a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "trigger_001",
      "routineId": "routine_abc123",
      "webhookEndpointId": "wh_001",
      "eventType": "push",
      "filters": {},
      "parameterMapping": {},
      "status": "active",
      "lastTriggeredAt": "2026-04-17T14:30:00Z",
      "createdAt": "2026-04-10T12:00:00Z",
      "webhookEndpoint": { "id": "wh_001", "provider": "github", "urlToken": "tok_abc123" }
    }
  ]
}
```

---

#### POST /api/v1/routines/:id/triggers

Add a trigger to a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhookEndpointId` | string | Yes | Webhook endpoint to listen on |
| `eventType` | string | Yes | Event type to match (e.g., `"push"`, `"pull_request.opened"`, `"*"`) |
| `filters` | object | No | Filter conditions: `{ "field.path": value }` or `{ "field.path": { "$contains": "text" } }` |
| `parameterMapping` | object | No | Map event payload fields to routine parameters: `{ "paramName": "event.field.path" }` |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "trigger_002",
    "routineId": "routine_abc123",
    "webhookEndpointId": "wh_002",
    "eventType": "message",
    "filters": {},
    "parameterMapping": { "channelName": "event.channel" },
    "status": "active",
    "lastTriggeredAt": null,
    "createdAt": "2026-04-17T10:20:00Z"
  }
}
```

---

#### DELETE /api/v1/routines/:id/triggers/:triggerId

Remove a trigger from a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |
| `triggerId` | string | Trigger ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

### Webhook Endpoints

#### GET /api/v1/routines/webhook-endpoints

List webhook endpoints registered for routines.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "wh_001",
      "orgId": "org_abc",
      "integrationId": "integration_001",
      "provider": "github",
      "urlToken": "tok_abc123",
      "enabled": true,
      "createdAt": "2026-04-10T12:00:00Z",
      "triggers": [
        { "id": "trigger_001", "routineId": "routine_abc123", "eventType": "push", "status": "active" }
      ]
    }
  ]
}
```

---

#### POST /api/v1/routines/webhook-endpoints

Create a new webhook endpoint.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | Webhook provider (e.g., `"github"`, `"slack"`, `"jira"`, `"notion"`) |
| `integrationId` | string | No | Link to an existing integration for credential lookup |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "wh_002",
    "orgId": "org_abc",
    "provider": "slack",
    "urlToken": "tok_def456",
    "plainSecret": "abc123...",
    "enabled": true,
    "createdAt": "2026-04-17T10:25:00Z"
  }
}
```

> The `plainSecret` is only returned on creation. Store it securely — it's needed to configure the webhook in the external service. The URL to configure is: `POST {your_hearth_url}/api/v1/webhooks/ingest/tok_def456`

---

#### DELETE /api/v1/routines/webhook-endpoints/:id

Delete a webhook endpoint.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Webhook endpoint ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

### Chains

#### GET /api/v1/routines/:id/chains

List chains attached to a routine. Chains define follow-up routines that execute after the parent completes.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "chain_001",
      "targetRoutineId": "routine_def789",
      "condition": "on_success",
      "createdAt": "2026-04-12T14:00:00Z"
    }
  ]
}
```

---

#### POST /api/v1/routines/:id/chains

Add a chain to a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetRoutineId` | string | Yes | Routine to trigger next |
| `condition` | string | No | When to trigger: `"on_success"`, `"on_failure"`, `"always"` (default: `"on_success"`) |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "chain_002",
    "targetRoutineId": "routine_ghi012",
    "condition": "always",
    "createdAt": "2026-04-17T10:30:00Z"
  }
}
```

---

#### DELETE /api/v1/routines/:id/chains/:chainId

Remove a chain from a routine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Routine ID |
| `chainId` | string | Chain ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

### Test Run

#### POST /api/v1/routines/test-run

Execute a one-off test run without creating a persistent routine.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Prompt to execute |

**Response:** `200 OK`

```json
{
  "data": {
    "output": "Test run output...",
    "duration": 2500,
    "completedAt": "2026-04-17T10:35:02Z"
  }
}
```

---

### Integrations

#### POST /api/v1/routines/integrations

List connected integrations and their available tools for use in routines.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "provider": "github",
      "connected": true,
      "tools": ["create_issue", "list_repos", "create_pr"]
    },
    {
      "provider": "slack",
      "connected": true,
      "tools": ["send_message", "list_channels"]
    }
  ]
}
```

## Types

```typescript
type RoutineScope = "personal" | "team" | "org";
type RoutineRunStatus = "success" | "failed" | "running" | "awaiting_approval";
type RoutineParameterType = "string" | "number" | "boolean" | "enum" | "date" | "date_range";

interface Routine {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  prompt: string;
  schedule: string | null;
  scope: RoutineScope;
  enabled: boolean;
  // State
  state: Record<string, unknown>;
  stateConfig: RoutineStateConfig;
  // Parameters
  parameters: RoutineParameter[];
  // Checkpoints
  checkpoints: ApprovalCheckpointDef[];
  // Delivery
  delivery: { channels: string[]; rules?: DeliveryRule[] };
  // Relations
  triggers: RoutineTrigger[];
  chainsFrom: RoutineChain[];
  chainsTo: RoutineChain[];
  runs: RoutineRun[];
  // Timestamps
  lastRunAt: string | null;
  lastRunStatus: RoutineRunStatus | null;
  createdAt: string;
  updatedAt: string;
}

interface RoutineStateConfig {
  previousRunCount?: number;   // default 3, max 10
  trackDeltas?: boolean;       // default false
  maxContextChars?: number;    // default 4000
}

interface RoutineParameter {
  name: string;
  type: RoutineParameterType;
  label: string;
  description?: string;
  required: boolean;
  default?: unknown;
  options?: string[];  // enum type only
}

interface RoutineRun {
  id: string;
  routineId: string;
  status: RoutineRunStatus;
  output: Record<string, unknown> | null;
  error: string | null;
  tokenCount: number | null;
  durationMs: number | null;
  summary: string | null;
  triggerId: string | null;
  triggerEvent: NormalizedEvent | null;
  parameterValues: Record<string, unknown> | null;
  triggeredBy: "schedule" | "manual" | "event" | "chain" | null;
  startedAt: string;
  completedAt: string | null;
}

interface RoutineTrigger {
  id: string;
  routineId: string;
  webhookEndpointId: string;
  eventType: string;
  filters: Record<string, unknown>;
  parameterMapping: Record<string, string>;
  status: "active" | "paused" | "error";
  lastTriggeredAt: string | null;
}

interface RoutineChain {
  id: string;
  sourceRoutineId: string;
  targetRoutineId: string;
  condition: "on_success" | "on_failure" | "always";
  parameterMapping: Record<string, string>;
  enabled: boolean;
}

interface WebhookEndpoint {
  id: string;
  orgId: string;
  integrationId: string | null;
  provider: string;
  urlToken: string;
  enabled: boolean;
  createdAt: string;
}

interface NormalizedEvent {
  provider: string;
  eventType: string;
  actor?: string;
  resource?: { type: string; id: string; title?: string; url?: string };
  payload: Record<string, unknown>;
  receivedAt: string;
}

interface ApprovalCheckpointDef {
  name: string;
  description?: string;
  position: number;
  approverPolicy: { type: "creator" | "role" | "user_ids"; roles?: string[]; userIds?: string[] };
  timeoutMinutes?: number;
  timeoutAction?: "approve" | "reject";
}

interface DeliveryRule {
  condition: { type: "always" | "contains" | "not_contains" | "agent_tag"; value?: string };
  targets: DeliveryTarget[];
}

interface DeliveryTarget {
  channel: "in_app" | "slack" | "notion" | "jira" | "email";
  config: Record<string, unknown>;
  template?: string;  // {{output}} placeholder
}

interface RoutineHealthAlert {
  id: string;
  orgId: string;
  routineId: string;
  alertType: "consecutive_failures" | "missed_schedule" | "high_cost";
  threshold: Record<string, unknown>;
  enabled: boolean;
  lastFiredAt: string | null;
}
```
