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
| `expectedVersion` | number | No | Reject the update with `409` if the routine is no longer at this version |
| `overrideTests` | boolean | No | Knowledge loop: save even though the new prompt drops text a [test case](#test-cases) needs. Owners only (`403` otherwise). Audit-logged |

A change to the definition (name, description, prompt, schedule, context, delivery, state config, scope, team, parameters, checkpoints) saves a new version and increases `version` by 1. Run state and enable/disable do not. `409 Conflict` carries `currentVersion` when `expectedVersion` is stale.

With the knowledge loop on, a new `prompt` that drops a phrase one of the routine's [test cases](#test-cases) needs is refused with `409` and `code: "tests_failed"` (see [The test guard](#the-test-guard)). Nothing is saved.

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

### Versions and owners

#### GET /api/v1/routines/:id/versions

The definition history of a routine, newest first. Anyone who can view the routine can read its history. Query: `page` (default `1`), `pageSize` (default `20`, max `100`).

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "rv_2",
      "routineId": "routine_abc123",
      "version": 2,
      "snapshot": {
        "name": "Weekly customer update",
        "prompt": "Post the update in #customer-updates",
        "schedule": "0 9 * * 1",
        "scope": "team",
        "teamId": "team_1"
      },
      "changeSource": "user",
      "changedById": "usr_lead",
      "restoredFrom": null,
      "createdAt": "2026-11-24T10:05:00Z",
      "changedBy": { "id": "usr_lead", "name": "Dana Lee" }
    }
  ],
  "total": 2,
  "page": 1,
  "pageSize": 20,
  "currentVersion": 2,
  "isOwner": true
}
```

The snapshot holds every definition field; the example is shortened. `changedBy` is the person who made the change (`null` for system changes or a deleted user). `isOwner` says whether the caller may restore versions.

#### POST /api/v1/routines/:id/rollback

Restore the definition of an earlier version as a **new** version. Scope and team are not restored, so a rollback never moves a routine to another audience. The schedule is re-registered. Owners only.

**Request Body:** `{ "version": 1 }` — add `"overrideTests": true` to restore a prompt that a [test case](#test-cases) blocks (audit-logged).

**Response:** `200 OK` — `{ "data": <Routine>, "changed": true }`

**Errors:** `400` bad body · `403` not an owner · `404` routine or version not found · `409` the routine changed during the rollback, or `code: "tests_failed"` (the restored prompt drops text a test case needs).

#### PATCH /api/v1/routines/:id/owner

Name an explicit owner, or `null` for the default. Admins only. The owner must be in the same organization, must not be a viewer, and must be on the team for a team routine. A personal routine is owned by its person.

**Request Body:** `{ "ownerId": "usr_123" }` or `{ "ownerId": null }`

| Scope | Default owners |
|-------|----------------|
| `personal` | The person who made it |
| `team` | Admins and team leads on that team |
| `org` | Every admin |

Agents may change only personal routines. A team or org routine changes only through its owner. An agent can never override a test case: an `update_routine` call whose prompt breaks one fails and tells the agent why.

### Knowledge loop: owners, dry runs and test cases

These routes exist only when the organization's `knowledgeLoop` flag is on; otherwise they answer `404`. A routine the caller cannot view answers `404` (another org, another team, someone else's personal routine). Changes and dry runs need an **owner** of the routine (the default owners above, plus a named owner). Members and viewers can read the owner and the test cases, and get `403` for the rest. The Phase 0 routes above (`versions`, `rollback`, `owner`) work whatever the flag.

#### GET /api/v1/routines/:id/ownership

Who owns the routine and what the caller may do.

```json
{
  "data": {
    "scope": "team",
    "defaultOwnerLabel": "Engineering leads and admins",
    "owner": { "id": "usr_sam", "name": "Sam Roe" },
    "isOwner": false,
    "canChangeOwner": true,
    "candidates": [{ "id": "usr_dana", "name": "Dana Lee", "role": "team_lead" }]
  }
}
```

`canChangeOwner` is true for admins on team and org routines. `candidates` (admins only) lists the people `PATCH /owner` accepts: not viewers, and on the team for a team routine.

#### POST /api/v1/routines/:id/dry-run

Run the routine once on its **last run's input** (its parameter values and trigger event) and return the output next to the last run's output. Use the saved prompt, or try a draft with `prompt`.

**Request Body:** `{}` or `{ "prompt": "A draft prompt for {{team}}" }` (1–20,000 characters; unknown fields are refused).

A dry run is a test:

- Nothing is delivered and no run is written (`/runs` does not change). The routine, its version and its state stay as they are.
- **Write tools are held back.** The agent only gets tools whose name reads as a read (`get`, `list`, `search`, `read`, `recall`, `fetch`, `find`, `lookup`, `query`, `view`) and has no write word (`send`, `post`, `create`, `update`, `save`, `delete`, …). Anything else — Slack posts, email, ticket creation, `create_routine`, `save_memory`, code execution — is not offered, and a call to it is answered "unknown tool". The result lists them in `blockedTools`.
- No knowledge-gap signals are recorded.
- It runs as the person who asked, with their own access.

The run is asynchronous. The answer is `202 Accepted` with a dry run in `status: "running"`; poll `GET /dry-runs/:dryRunId`. A run is stopped after 5 minutes.

**Errors:** `400` bad body · `403` not an owner · `404` not found or flag off · `409` `no_past_run` (the routine has never finished a run, so there is no input to replay — run it once first) · `429` `too_many_dry_runs` (at most 3 running per person).

#### GET /api/v1/routines/:id/dry-runs/:dryRunId

One dry run. Only the person who started it can read it, and only for 24 hours; after that it answers `404`. Two people dry-running the same routine get separate results.

```json
{
  "data": {
    "id": "dr_1",
    "routineId": "routine_abc123",
    "kind": "dry_run",
    "status": "success",
    "candidatePrompt": "A draft prompt for {{team}}",
    "routineVersion": 4,
    "sourceRun": { "id": "run_9", "status": "success", "startedAt": "2026-11-24T09:00:00Z", "error": null },
    "lastOutput": "Two tickets…",
    "output": "Three tickets from the Support queue…",
    "error": null,
    "testResults": null,
    "blockedTools": ["slack_post_message", "save_memory"],
    "durationMs": 8120,
    "createdAt": "2026-11-24T10:00:00Z",
    "completedAt": "2026-11-24T10:00:08Z",
    "expiresAt": "2026-11-25T10:00:00Z"
  }
}
```

`status` is `running`, `success` or `failed` (with `error`). A run left `running` long after the 5-minute limit (for example after a restart) reads as `failed`.

### Test cases

A test case is a short list of phrases a routine must keep. Approving a curator fix to a routine prompt in the [Review inbox](/developers/api/knowledge) creates one (`source: "proposal"`, described from the prompt's own words, never the curator's reason); owners add their own (`source: "manual"`).

**Phrases from a fix** are found the same way every time: compare the old and new prompt word by word, take each run of words the fix added, split it at punctuation, trim filler words (`the`, `use`, `from`, …) from both ends, keep pieces of at least 3 characters, cut each to 60 characters at a word, and keep the first 5. A fix that only removes text makes no test case. Example: `Summarise tickets.` → `Summarise tickets from the Support queue (use ticket_lookup).` gives `["Support queue", "ticket_lookup"]`.

Matching ignores case, curly versus straight quotes, and extra spaces.

```ts
interface RoutineTestCase {
  id: string;
  routineId: string;
  proposalId: string | null;      // the approved fix it came from
  description: string;
  mustContain: string[];          // 1–10 phrases, each 1–200 characters
  source: "proposal" | "manual";
  createdById: string | null;
  lastStatus: "passed" | "failed" | null;   // from the last "Run tests"
  lastCheckedAt: string | null;
  lastMissing: string[] | null;   // phrases the output was missing
  createdAt: string;
  updatedAt: string;
}
```

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/routines/:id/test-cases` | anyone who can view | `{ data: RoutineTestCase[], canEdit }` |
| `POST` | `/routines/:id/test-cases` | owners | `{ description, mustContain }` → `201`. At most 50 per routine (`409`) |
| `PATCH` | `/routines/:id/test-cases/:caseId` | owners | `{ description?, mustContain? }`. New phrases clear the last result |
| `DELETE` | `/routines/:id/test-cases/:caseId` | owners | `204` |
| `POST` | `/routines/:id/test-cases/run` | owners | Dry run + check every case (below) |

Bad bodies (empty description, no phrases, more than 10, too long, unknown fields) answer `400`. A case id from another routine or org answers `404`. Each change writes an audit row (`routine_test_case_created`, `…_updated`, `…_deleted`).

#### POST /api/v1/routines/:id/test-cases/run

"Run tests": a [dry run](#post-api-v1-routines-id-dry-run) with `kind: "tests"`. When it finishes, each case passes when the output contains every phrase. The result's `testResults` is `[{ testCaseId, description, passed, missing }]`. For the saved prompt the result is also stored on each case (`lastStatus`, `lastCheckedAt`, `lastMissing`); a draft `prompt` reports results without storing them. Same body, answers and errors as the dry run, plus `409` `no_test_cases`.

#### The test guard

Any change to the prompt is checked against the test cases: an edit (`PATCH /routines/:id`), a restore (`POST /rollback`) and approving a later curator fix (`POST /knowledge/proposals/:id/approve`). A phrase blocks the change when the **current** prompt has it and the new prompt does not. (A phrase that is only meant for the output, and is not in the prompt, never blocks an edit.)

A blocked change saves nothing and answers:

```json
{
  "error": "This change removes text that a test case needs. Keep the text, change the test case, or save anyway.",
  "code": "tests_failed",
  "failures": [
    {
      "testCaseId": "tc_1",
      "description": "Keeps an approved fix: the prompt says \"Support queue\"",
      "missing": ["Support queue"],
      "reason": "The new prompt no longer says \"Support queue\"."
    }
  ]
}
```

To go ahead anyway, an owner sends the same request with `"overrideTests": true`. That writes an audit row `knowledge_tests_override` with `via` (`edit`, `rollback` or `proposal`) and the test case ids. A non-owner sending `overrideTests` gets `403`. With the flag off the guard is off.

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
  // Versions
  version: number;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RoutineVersion {
  id: string;
  routineId: string;
  version: number;
  snapshot: RoutineSnapshot; // name, description, prompt, schedule, context, delivery,
                             // stateConfig, scope, teamId, parameters, checkpoints
  changeSource: "user" | "agent" | "rollback" | "migration" | "curator";
  changedById: string | null;
  restoredFrom: number | null;
  createdAt: string;
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
