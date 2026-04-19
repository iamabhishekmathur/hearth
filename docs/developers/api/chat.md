# Chat & Sessions

Chat is the primary interface for interacting with the Hearth AI agent. Conversations are organized into sessions, which can be private or shared with the organization. Sessions support real-time collaboration, message attachments, and artifact references.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

### Sessions

#### POST /api/v1/chat/sessions

Create a new chat session.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Session title. Auto-generated if omitted. |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "session_abc123",
    "title": "New session",
    "visibility": "private",
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### GET /api/v1/chat/sessions

List all chat sessions owned by the current user.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "session_abc123",
      "title": "Project planning",
      "visibility": "private",
      "createdAt": "2026-04-17T10:00:00Z",
      "updatedAt": "2026-04-17T10:00:00Z"
    }
  ]
}
```

---

#### GET /api/v1/chat/sessions/shared

List all sessions visible to the organization.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "session_def456",
      "title": "Team standup notes",
      "visibility": "org",
      "createdAt": "2026-04-17T09:00:00Z",
      "updatedAt": "2026-04-17T09:30:00Z"
    }
  ]
}
```

---

#### GET /api/v1/chat/sessions/:id

Get a session with its messages and attachments.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "session_abc123",
    "title": "Project planning",
    "visibility": "private",
    "messages": [
      {
        "id": "msg_001",
        "role": "user",
        "content": "Help me plan the sprint",
        "attachments": [],
        "createdAt": "2026-04-17T10:01:00Z"
      },
      {
        "id": "msg_002",
        "role": "assistant",
        "content": "Here's a suggested sprint plan...",
        "attachments": [],
        "createdAt": "2026-04-17T10:01:05Z"
      }
    ],
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:01:05Z"
  }
}
```

---

#### PATCH /api/v1/chat/sessions/:id

Rename a chat session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | New session title |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "session_abc123",
    "title": "Updated title",
    "visibility": "private",
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:05:00Z"
  }
}
```

---

#### PATCH /api/v1/chat/sessions/:id/visibility

Change session visibility between private and organization-wide.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `visibility` | string | Yes | `"private"` or `"org"` |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "session_abc123",
    "title": "Project planning",
    "visibility": "org",
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:06:00Z"
  }
}
```

---

#### DELETE /api/v1/chat/sessions/:id

Archive a chat session. Archived sessions are soft-deleted and no longer appear in listings.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Response:** `200 OK`

```json
{
  "data": { "archived": true }
}
```

---

### Messages

#### POST /api/v1/chat/sessions/:id/messages

Send a message to a session and trigger the AI agent. The response is delivered asynchronously via WebSocket events.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Message text |
| `model` | string | No | LLM model override |
| `providerId` | string | No | LLM provider override |
| `activeArtifactId` | string | No | Artifact currently open in the UI for context |
| `attachmentIds` | string[] | No | IDs of uploaded files to attach |

**Response:** `202 Accepted`

The agent processes the message asynchronously. Streaming responses and tool calls are delivered via WebSocket events on the session channel.

---

### Collaborators

#### GET /api/v1/chat/sessions/:id/collaborators

List collaborators on a session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "userId": "user_abc",
      "displayName": "Alice",
      "role": "editor",
      "joinedAt": "2026-04-17T10:00:00Z"
    }
  ]
}
```

---

#### POST /api/v1/chat/sessions/:id/collaborators

Add a collaborator to a session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID to add |
| `role` | string | No | Collaborator role (default: `"viewer"`) |

**Response:** `201 Created`

```json
{
  "data": {
    "userId": "user_def",
    "displayName": "Bob",
    "role": "viewer",
    "joinedAt": "2026-04-17T10:10:00Z"
  }
}
```

---

#### DELETE /api/v1/chat/sessions/:id/collaborators/:userId

Remove a collaborator from a session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |
| `userId` | string | User ID to remove |

**Response:** `200 OK`

```json
{
  "data": { "removed": true }
}
```

---

#### POST /api/v1/chat/sessions/:id/join

Join an organization-visible session as a collaborator.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID (must have `"org"` visibility) |

**Response:** `200 OK`

```json
{
  "data": {
    "userId": "user_ghi",
    "displayName": "Charlie",
    "role": "viewer",
    "joinedAt": "2026-04-17T10:15:00Z"
  }
}
```

---

### Sharing

#### POST /api/v1/sharing/chat/sessions/:id/share

Create a shareable link for a session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contentFilter` | string | No | `"all"`, `"responses"`, or `"prompts"` (default: `"all"`) |
| `expiresAt` | string | No | ISO 8601 expiration timestamp |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "share_xyz",
    "token": "abc123def456",
    "contentFilter": "all",
    "expiresAt": null,
    "url": "/shared/abc123def456",
    "createdAt": "2026-04-17T10:20:00Z"
  }
}
```

---

#### GET /api/v1/sharing/shared/:token

View a shared session via its public token. No authentication required.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `token` | string | Share link token |

**Response:** `200 OK`

```json
{
  "data": {
    "session": {
      "title": "Project planning",
      "messages": [...]
    },
    "contentFilter": "all"
  }
}
```

---

#### POST /api/v1/sharing/chat/sessions/:id/duplicate

Duplicate a session into a new private session.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `upToMessageId` | string | No | Copy messages up to and including this message ID |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "session_new123",
    "title": "Project planning (copy)",
    "visibility": "private",
    "createdAt": "2026-04-17T10:25:00Z",
    "updatedAt": "2026-04-17T10:25:00Z"
  }
}
```

---

#### POST /api/v1/sharing/chat/sessions/:id/fork

Fork a session, creating an independent copy that diverges from the original.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "session_fork456",
    "title": "Project planning (fork)",
    "visibility": "private",
    "forkedFrom": "session_abc123",
    "createdAt": "2026-04-17T10:30:00Z",
    "updatedAt": "2026-04-17T10:30:00Z"
  }
}
```

---

### User Search

#### GET /api/v1/chat/users/search

Search for users by name or email. Used for adding collaborators.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query (minimum 2 characters) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "user_abc",
      "displayName": "Alice",
      "email": "alice@example.com"
    }
  ]
}
```

### Cognitive Profile (User)

#### GET /api/v1/chat/cognitive-profile/status

Get the current user's cognitive profile status, including whether the org feature is enabled and whether the user has opted in.

**Response:** `200 OK`

```json
{
  "data": {
    "orgEnabled": true,
    "userEnabled": true
  }
}
```

---

#### PUT /api/v1/chat/cognitive-profile/status

Toggle the current user's cognitive profile opt-in/out. Only works when the org feature is enabled.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | Whether to opt in to cognitive profiles |

**Response:** `200 OK`

```json
{
  "message": "Cognitive profile status updated"
}
```

---

### Sending a Cognitive Query (@mention)

To query a coworker's cognitive profile, include the `cognitiveQuery` field in the message request body:

#### POST /api/v1/chat/sessions/:id/messages (with cognitive query)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Message content (e.g., `@sarah how would you approach this?`) |
| `cognitiveQuery` | object | No | Cognitive query metadata |
| `cognitiveQuery.subjectUserId` | string | Yes (if cognitiveQuery provided) | User ID of the person whose perspective to query |

**Response:** `202 Accepted`

The AI's response will include the subject's cognitive profile and relevant thought patterns in its system prompt context. The response streams through the normal WebSocket flow.

::: info
The `cognitiveQuery` field is ignored when the org's cognitive profiles feature is disabled, or when the subject user has opted out.
:::

## Types

```typescript
interface Session {
  id: string;
  title: string;
  visibility: "private" | "org";
  messages?: Message[];
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Attachment[];
  createdAt: string;
}

interface Collaborator {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

interface ShareLink {
  id: string;
  token: string;
  contentFilter: "all" | "responses" | "prompts";
  expiresAt: string | null;
  url: string;
  createdAt: string;
}
```
