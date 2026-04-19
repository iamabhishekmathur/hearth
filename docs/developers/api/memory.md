# Memory

Memory stores contextual knowledge that the AI agent uses to personalize responses and maintain continuity. Memories are organized into layers (org, team, user, session) and support hybrid search combining vector similarity and full-text search.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

#### GET /api/v1/memory

List memory entries with optional filtering.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `layer` | string | No | Filter by layer: `"org"`, `"team"`, `"user"`, or `"session"` |
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
| `layer` | string | Yes | `"org"`, `"team"`, `"user"`, or `"session"` |
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
    "createdAt": "2026-04-16T14:00:00Z",
    "updatedAt": "2026-04-17T10:05:00Z"
  }
}
```

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
| `session` | Chat session | Scoped to a single conversation |

Memories are automatically surfaced by the agent during conversations based on relevance. Higher-specificity layers (session > user > team > org) take precedence when memories conflict.

## Types

```typescript
interface MemoryEntry {
  id: string;
  layer: "org" | "team" | "user" | "session";
  content: string;
  source: string | null;
  sourceRef: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemorySearchResult extends MemoryEntry {
  score: number;
}
```
