# Memory

Memory stores contextual knowledge that the AI agent uses to personalize responses and maintain continuity. Memories are organized into layers (org, team, user) and support hybrid search combining vector similarity and full-text search.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

#### GET /api/v1/memory

List memory entries with optional filtering.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `layer` | string | No | Filter by layer: `"org"`, `"team"`, or `"user"` |
| `page` | number | No | Page number (default: `1`) |
| `pageSize` | number | No | Items per page (default: `20`) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "mem_abc123",
      "layer": "user",
      "content": "Prefers concise responses with code examples",
      "source": "agent",
      "sourceRef": "session_xyz",
      "expiresAt": null,
      "createdAt": "2026-04-16T14:00:00Z",
      "updatedAt": "2026-04-16T14:00:00Z"
    }
  ],
  "total": 45,
  "page": 1,
  "pageSize": 20
}
```

---

#### GET /api/v1/memory/:id

Get a single memory entry.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Memory entry ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "mem_abc123",
    "layer": "user",
    "content": "Prefers concise responses with code examples",
    "source": "agent",
    "sourceRef": "session_xyz",
    "expiresAt": null,
    "createdAt": "2026-04-16T14:00:00Z",
    "updatedAt": "2026-04-16T14:00:00Z"
  }
}
```

---

#### POST /api/v1/memory

Create a new memory entry.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `layer` | string | Yes | `"org"`, `"team"`, or `"user"` |
| `content` | string | Yes | Memory content text |
| `source` | string | No | Origin of the memory (e.g., `"user"`, `"agent"`) |
| `sourceRef` | string | No | Reference ID (e.g., session or task ID) |
| `expiresAt` | string | No | ISO 8601 expiration timestamp |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "mem_new456",
    "layer": "team",
    "content": "The team uses trunk-based development with feature flags",
    "source": "user",
    "sourceRef": null,
    "expiresAt": null,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### PATCH /api/v1/memory/:id

Update an existing memory entry.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Memory entry ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | No | Updated content |
| `source` | string | No | Updated source |
| `sourceRef` | string | No | Updated source reference |
| `expiresAt` | string | No | Updated expiration timestamp |
| `expectedVersion` | number | No | Reject the update with `409` if the entry is no longer at this version |

A content change on an `org`, `team` or `user` entry saves a new version and increases `version` by 1. Changes to `source`, `sourceRef` or `expiresAt` alone do not.

**Response:** `200 OK`

```json
{
  "data": {
    "id": "mem_abc123",
    "layer": "user",
    "content": "Prefers detailed responses with code examples and tests",
    "source": "agent",
    "sourceRef": "session_xyz",
    "expiresAt": null,
    "version": 2,
    "ownerId": null,
    "createdAt": "2026-04-16T14:00:00Z",
    "updatedAt": "2026-04-17T10:05:00Z"
  }
}
```

**Errors:** `409 Conflict` when `expectedVersion` is stale. The body carries `currentVersion`.

---

#### GET /api/v1/memory/:id/versions

The version history of a memory entry, newest first. Anyone who can read the entry can read its history.

**Query Parameters:** `page` (default `1`), `pageSize` (default `20`, max `100`).

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "ver_2",
      "memoryId": "mem_abc123",
      "version": 2,
      "content": "Post the weekly update in #customer-updates",
      "changeSource": "user",
      "changedById": "usr_lead",
      "restoredFrom": null,
      "createdAt": "2026-11-24T10:05:00Z"
    }
  ],
  "total": 2,
  "page": 1,
  "pageSize": 20,
  "currentVersion": 2
}
```

`changeSource` is one of `user`, `agent`, `synthesis`, `rollback`, `migration`, `curator`.

---

#### POST /api/v1/memory/:id/rollback

Restore the content of an earlier version. Hearth writes a **new** version with that content; history is never rewritten. Owners only (see [Owners](#owners)).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | number | Yes | The version to restore |

**Response:** `200 OK` — `{ "data": <MemoryEntry>, "changed": true }`. `changed` is `false` when the content already matches that version.

**Errors:** `400` bad body · `403` not an owner · `404` entry or version not found · `409` the entry changed during the rollback.

---

#### PATCH /api/v1/memory/:id/owner

Name an explicit owner, or `null` to use the default owner for the layer. Admins only.

**Request Body:** `{ "ownerId": "usr_123" }` or `{ "ownerId": null }`

The owner must be in the same organization and must not be a viewer. The owner of a team entry must be on that team. A `user` entry is always owned by its person.

**Errors:** `400` invalid owner · `403` not an admin · `404` entry not found.

---

#### DELETE /api/v1/memory/:id

Delete a memory entry.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Memory entry ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

#### POST /api/v1/memory/search

Search memory using hybrid vector similarity and full-text search. Results are ranked by relevance.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Search query text |
| `layer` | string | No | Restrict search to a specific layer |
| `limit` | number | No | Maximum results to return (default: `10`) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "mem_abc123",
      "layer": "user",
      "content": "Prefers concise responses with code examples",
      "source": "agent",
      "sourceRef": "session_xyz",
      "score": 0.92,
      "createdAt": "2026-04-16T14:00:00Z"
    },
    {
      "id": "mem_org001",
      "layer": "org",
      "content": "Company coding standards require TypeScript strict mode",
      "source": "user",
      "sourceRef": null,
      "score": 0.78,
      "createdAt": "2026-04-10T09:00:00Z"
    }
  ]
}
```

## Memory Layers

| Layer | Scope | Description |
|-------|-------|-------------|
| `org` | Organization-wide | Shared across all users and teams |
| `team` | Team | Shared within a specific team |
| `user` | Individual | Personal to the authenticated user |

Memories are automatically surfaced by the agent during conversations based on relevance. Higher-specificity layers (user > team > org) take precedence when memories conflict.

The agent also maintains ephemeral session context internally (auto-created, auto-expires after 24 hours). Session context is not exposed via the API and cannot be managed by users.

## Owners

An owner can roll back an entry, and later will review proposed changes to it.

| Layer | Default owners |
|-------|----------------|
| `org` | Every admin |
| `team` | Admins and that team's team leads |
| `user` | The person |

An explicit owner set with `PATCH /memory/:id/owner` is added to the default owners.

## Types

```typescript
interface MemoryEntry {
  id: string;
  layer: "org" | "team" | "user";
  content: string;
  source: string | null;
  sourceRef: string | null;
  expiresAt: string | null;
  version: number;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryVersion {
  id: string;
  memoryId: string;
  version: number;
  content: string;
  changeSource: "user" | "agent" | "synthesis" | "rollback" | "migration" | "curator";
  changedById: string | null;
  restoredFrom: number | null;
  createdAt: string;
}

interface MemorySearchResult extends MemoryEntry {
  score: number;
}
```
