# Decisions API

The Decisions API provides CRUD operations for the Context Graph — organizational decision tracking, search, graph traversal, and pattern/principle queries.

**Base path:** `/api/v1/decisions`

All endpoints require authentication.

[[toc]]

## List Decisions

```http
GET /api/v1/decisions
```

Cursor-paginated list of decisions visible to the current user.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cursor` | string | Cursor for pagination (ISO timestamp) |
| `limit` | number | Max results (default 20, max 100) |
| `domain` | string | Filter by domain (e.g., `engineering`) |
| `status` | string | Filter by status |
| `scope` | string | Filter by scope (`org`, `team`, `personal`) |
| `teamId` | string | Filter by team |

**Response:** `{ data: Decision[], cursor: string | null, hasMore: boolean }`

## Create Decision

```http
POST /api/v1/decisions
```

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | What was decided |
| `reasoning` | string | Yes | Why it was decided |
| `description` | string | No | Additional context |
| `alternatives` | array | No | `[{ label, pros?, cons? }]` |
| `domain` | string | No | Domain category |
| `tags` | string[] | No | Tags for filtering |
| `scope` | string | No | `org` (default), `team`, `personal` |
| `confidence` | string | No | `low`, `medium` (default), `high` |
| `source` | string | No | `manual` (default), `chat`, `meeting`, etc. |
| `sensitivity` | string | No | `normal` (default), `restricted`, `confidential` |
| `participants` | string[] | No | User IDs involved |
| `teamId` | string | No | Team scope |

The server automatically generates an embedding, checks for duplicates (cosine > 0.90 = merge), and auto-links related decisions (cosine > 0.75).

**Response:** `{ data: Decision }` (201)

## Search Decisions

```http
POST /api/v1/decisions/search
```

Hybrid search combining vector similarity and full-text search with Reciprocal Rank Fusion (RRF).

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `domain` | string | No | Filter by domain |
| `status` | string | No | Filter by status |
| `since` | string | No | ISO date filter |
| `limit` | number | No | Max results (default 20) |

**Response:** `{ decisions: Decision[], total: number }`

## Get Decision

```http
GET /api/v1/decisions/:id
```

Returns the full decision with contexts, outcomes, and related links.

**Response:** `{ data: Decision }` (includes `outcomes`, `links`, `contexts`)

## Update Decision

```http
PATCH /api/v1/decisions/:id
```

Update decision fields. If `title` or `reasoning` changes, the embedding is regenerated.

## Archive Decision

```http
DELETE /api/v1/decisions/:id
```

Soft-deletes by setting status to `archived`.

## Decision Graph

```http
GET /api/v1/decisions/:id/graph?depth=2
```

Returns the subgraph around a decision using recursive CTE traversal.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `depth` | number | Traversal depth (default 2, max 5) |

**Response:** `{ data: { nodes: GraphNode[], edges: GraphEdge[] } }`

## Decision Links

```http
POST /api/v1/decisions/:id/dependencies
```

Add a relationship link between two decisions.

**Body:** `{ toDecisionId: string, relationship: string, description?: string }`

Relationship types: `depends_on`, `supersedes`, `related_to`, `informed_by`, `contradicts`.

```http
DELETE /api/v1/decisions/:id/dependencies/:depId
```

Remove a decision link.

## Outcomes

```http
POST /api/v1/decisions/:id/outcomes
```

Record an outcome for a decision.

**Body:** `{ verdict: string, description: string, impactScore?: number, evidence?: object }`

Verdict values: `positive`, `negative`, `mixed`, `neutral`, `too_early`.

```http
GET /api/v1/decisions/:id/outcomes
```

List all outcomes for a decision.

## Review Queue

```http
GET /api/v1/decisions/pending-review
```

Returns draft decisions needing human validation.

```http
POST /api/v1/decisions/:id/confirm
```

Promote a draft decision to `active`.

```http
POST /api/v1/decisions/:id/dismiss
```

Archive a false-positive draft.

## Patterns

```http
GET /api/v1/decisions/patterns?domain=engineering
```

List decision patterns, optionally filtered by domain.

## Principles

```http
GET /api/v1/decisions/principles?domain=engineering
```

List organizational principles, optionally filtered by domain.

## Meetings

**Base path:** `/api/v1/meetings`

```http
POST /api/v1/meetings/ingest
```

Ingest meeting notes for decision extraction.

**Body:** `{ title: string, transcript?: string, summary?: string, participants?: string[], meetingDate?: string, provider?: string, calendarEventId?: string }`

If a transcript is provided, it is queued for automatic decision extraction.

```http
GET /api/v1/meetings
```

List ingested meetings.

```http
GET /api/v1/meetings/:id
```

Get meeting detail with extracted decisions.
