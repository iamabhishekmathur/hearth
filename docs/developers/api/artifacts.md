# Artifacts

Artifacts are structured outputs generated during chat sessions, such as code snippets, documents, diagrams, and tables. They are versioned, allowing users to track changes over time as the AI agent iterates on them.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

#### POST /api/v1/artifacts/sessions/:sessionId/artifacts

Create a new artifact within a chat session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Chat session ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Artifact type: `"code"`, `"document"`, `"diagram"`, `"table"`, `"html"`, or `"image"` |
| `title` | string | Yes | Artifact title |
| `content` | string | Yes | Artifact content |
| `language` | string | No | Programming language (for `"code"` type, e.g., `"typescript"`, `"python"`) |
| `parentMessageId` | string | No | Message ID that triggered this artifact |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "artifact_abc123",
    "sessionId": "session_xyz",
    "type": "code",
    "title": "UserService implementation",
    "content": "export class UserService {\n  ...\n}",
    "language": "typescript",
    "parentMessageId": "msg_002",
    "version": 1,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### GET /api/v1/artifacts/sessions/:sessionId/artifacts

List all artifacts in a chat session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Chat session ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "artifact_abc123",
      "sessionId": "session_xyz",
      "type": "code",
      "title": "UserService implementation",
      "language": "typescript",
      "version": 2,
      "createdAt": "2026-04-17T10:00:00Z",
      "updatedAt": "2026-04-17T10:15:00Z"
    },
    {
      "id": "artifact_def456",
      "sessionId": "session_xyz",
      "type": "diagram",
      "title": "System architecture",
      "language": null,
      "version": 1,
      "createdAt": "2026-04-17T10:05:00Z",
      "updatedAt": "2026-04-17T10:05:00Z"
    }
  ]
}
```

---

#### GET /api/v1/artifacts/:id

Get a single artifact with its current content.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Artifact ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "artifact_abc123",
    "sessionId": "session_xyz",
    "type": "code",
    "title": "UserService implementation",
    "content": "export class UserService {\n  async getUser(id: string) {\n    ...\n  }\n}",
    "language": "typescript",
    "parentMessageId": "msg_002",
    "version": 2,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:15:00Z"
  }
}
```

---

#### PATCH /api/v1/artifacts/:id

Update an artifact. Creates a new version automatically.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Artifact ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Updated title |
| `content` | string | No | Updated content |
| `language` | string | No | Updated language |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "artifact_abc123",
    "sessionId": "session_xyz",
    "type": "code",
    "title": "UserService implementation",
    "content": "export class UserService {\n  async getUser(id: string) {\n    return prisma.user.findUnique({ where: { id } });\n  }\n}",
    "language": "typescript",
    "parentMessageId": "msg_002",
    "version": 3,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:30:00Z"
  }
}
```

---

#### DELETE /api/v1/artifacts/:id

Delete an artifact and all its versions.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Artifact ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

#### GET /api/v1/artifacts/:id/versions

Get all versions of an artifact, ordered from newest to oldest.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Artifact ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "version": 3,
      "content": "export class UserService {\n  async getUser(id: string) {\n    return prisma.user.findUnique({ where: { id } });\n  }\n}",
      "createdAt": "2026-04-17T10:30:00Z"
    },
    {
      "version": 2,
      "content": "export class UserService {\n  async getUser(id: string) {\n    ...\n  }\n}",
      "createdAt": "2026-04-17T10:15:00Z"
    },
    {
      "version": 1,
      "content": "export class UserService {\n  ...\n}",
      "createdAt": "2026-04-17T10:00:00Z"
    }
  ]
}
```

## Artifact Types

| Type | Description | Supports `language` |
|------|-------------|---------------------|
| `code` | Source code snippets or full files | Yes |
| `document` | Prose, markdown, or structured text | No |
| `diagram` | Mermaid, PlantUML, or other diagram markup | No |
| `table` | Tabular data (CSV, JSON array) | No |
| `html` | Rendered HTML content | No |
| `image` | Generated or referenced images | No |

## Types

```typescript
interface Artifact {
  id: string;
  sessionId: string;
  type: "code" | "document" | "diagram" | "table" | "html" | "image";
  title: string;
  content: string;
  language: string | null;
  parentMessageId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ArtifactVersion {
  version: number;
  content: string;
  createdAt: string;
}
```
