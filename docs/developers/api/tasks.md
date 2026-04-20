# Tasks

Tasks represent units of work tracked by Hearth. They can be created manually, by the AI agent, or auto-detected from conversations. Tasks support hierarchical subtasks, execution steps, review workflows, and context merging.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

### Core

#### GET /api/v1/tasks

List tasks for the current user.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status (e.g., `"open"`, `"in_progress"`, `"done"`) |
| `parentOnly` | boolean | No | If `true`, return only top-level tasks (no subtasks) |
| `page` | number | No | Page number (default: `1`) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "task_abc123",
      "title": "Implement user onboarding flow",
      "description": "Create the multi-step onboarding wizard",
      "status": "in_progress",
      "priority": "high",
      "source": "agent",
      "parentTaskId": null,
      "createdAt": "2026-04-17T08:00:00Z",
      "updatedAt": "2026-04-17T09:30:00Z"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20
}
```

---

#### GET /api/v1/tasks/:id

Get a single task by ID.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "task_abc123",
    "title": "Implement user onboarding flow",
    "description": "Create the multi-step onboarding wizard",
    "status": "in_progress",
    "priority": "high",
    "source": "agent",
    "parentTaskId": null,
    "subtasks": [],
    "createdAt": "2026-04-17T08:00:00Z",
    "updatedAt": "2026-04-17T09:30:00Z"
  }
}
```

---

#### POST /api/v1/tasks

Create a new task.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Task title |
| `description` | string | Yes | Task description |
| `source` | string | Yes | Origin of the task (e.g., `"user"`, `"agent"`, `"routine"`) |
| `priority` | string | No | `"low"`, `"medium"`, `"high"`, or `"urgent"` |
| `parentTaskId` | string | No | Parent task ID for creating subtasks |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "task_new789",
    "title": "Design login page",
    "description": "Create wireframes and final design for login",
    "status": "open",
    "priority": "medium",
    "source": "user",
    "parentTaskId": null,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### PATCH /api/v1/tasks/:id

Update a task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Updated title |
| `description` | string | No | Updated description |
| `status` | string | No | New status |
| `priority` | string | No | New priority |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "task_abc123",
    "title": "Implement user onboarding flow",
    "description": "Create the multi-step onboarding wizard",
    "status": "done",
    "priority": "high",
    "source": "agent",
    "parentTaskId": null,
    "createdAt": "2026-04-17T08:00:00Z",
    "updatedAt": "2026-04-17T11:00:00Z"
  }
}
```

---

#### DELETE /api/v1/tasks/:id

Delete a task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

### Comments

#### GET /api/v1/tasks/:id/comments

List comments on a task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "comment_001",
      "content": "Looks good, but needs error handling",
      "userId": "user_abc",
      "createdAt": "2026-04-17T10:30:00Z"
    }
  ]
}
```

---

#### POST /api/v1/tasks/:id/comments

Add a comment to a task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Comment text |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "comment_002",
    "content": "Added retry logic for network failures",
    "userId": "user_abc",
    "createdAt": "2026-04-17T10:35:00Z"
  }
}
```

---

### Execution Steps

#### GET /api/v1/tasks/:id/steps

Get execution steps for a task. Steps are created by the agent as it works through a task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "step_001",
      "description": "Analyze requirements",
      "status": "completed",
      "output": "Identified 3 key user flows",
      "createdAt": "2026-04-17T08:01:00Z"
    },
    {
      "id": "step_002",
      "description": "Generate implementation plan",
      "status": "in_progress",
      "output": null,
      "createdAt": "2026-04-17T08:02:00Z"
    }
  ]
}
```

---

### Context

#### POST /api/v1/tasks/:id/context

Merge a context patch into the task's context object. Useful for providing the agent with additional information mid-execution.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Request Body:**

A JSON object to deep-merge into the existing task context.

```json
{
  "requirements": {
    "auth": "OAuth2 only"
  }
}
```

**Response:** `200 OK`

```json
{
  "data": {
    "context": {
      "requirements": {
        "auth": "OAuth2 only"
      }
    }
  }
}
```

---

### Reviews

#### GET /api/v1/tasks/:id/reviews

List reviews for a task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "review_001",
      "decision": "changes_requested",
      "feedback": "Please add input validation",
      "userId": "user_abc",
      "createdAt": "2026-04-17T11:00:00Z"
    }
  ]
}
```

---

#### POST /api/v1/tasks/:id/reviews

Submit a review for a task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `decision` | string | Yes | `"approved"` or `"changes_requested"` |
| `feedback` | string | No | Review feedback text |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "review_002",
    "decision": "approved",
    "feedback": "Looks great!",
    "userId": "user_abc",
    "createdAt": "2026-04-17T11:30:00Z"
  }
}
```

---

### Replanning

#### POST /api/v1/tasks/:id/replan

Request the agent to replan a task based on feedback.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `feedback` | string | Yes | Feedback to guide replanning |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "task_abc123",
    "status": "replanning",
    "updatedAt": "2026-04-17T11:35:00Z"
  }
}
```

---

### Subtasks

#### POST /api/v1/tasks/:id/subtasks

Create a subtask under an existing task.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Parent task ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Subtask title |
| `description` | string | No | Subtask description |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "task_sub001",
    "title": "Write unit tests",
    "description": "Cover edge cases for form validation",
    "status": "open",
    "priority": null,
    "source": "user",
    "parentTaskId": "task_abc123",
    "createdAt": "2026-04-17T11:40:00Z",
    "updatedAt": "2026-04-17T11:40:00Z"
  }
}
```

---

### Context Items (Rich Context)

Context items let you attach links, files, PDFs, images, text blocks, and MCP integration data to any task. Content is extracted asynchronously and fed into the planning/execution agents with token budgeting.

#### GET /api/v1/tasks/:id/context-items

List all context items for a task.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "ci_001",
      "taskId": "task_abc123",
      "type": "link",
      "label": "API Design Guide",
      "rawValue": "https://example.com/api-design",
      "extractedText": "Fetched page content...",
      "extractedTitle": "API Design Best Practices",
      "extractionStatus": "completed",
      "sortOrder": 0,
      "createdAt": "2026-04-19T10:00:00Z"
    }
  ]
}
```

#### POST /api/v1/tasks/:id/context-items

Add a context item (note, link, text_block, or mcp_reference).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `"note"`, `"link"`, `"text_block"`, or `"mcp_reference"` |
| `rawValue` | string | Yes | The content: text for notes, URL for links, etc. |
| `label` | string | No | Display label |
| `mcpIntegrationId` | string | No | MCP integration ID (for mcp_reference) |
| `mcpResourceType` | string | No | e.g., `"notion_page"`, `"slack_thread"` |
| `mcpResourceId` | string | No | Resource ID in the external system |

**Response:** `201 Created`

#### POST /api/v1/tasks/:id/context-items/upload

Upload a file or image as a context item. Uses `multipart/form-data` with a `file` field.

**Response:** `201 Created`

#### PATCH /api/v1/tasks/:id/context-items/:itemId

Update a context item's label or sort order.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | No | Updated label |
| `sortOrder` | number | No | New sort position |

**Response:** `200 OK`

#### DELETE /api/v1/tasks/:id/context-items/:itemId

Remove a context item (and delete associated file from disk if applicable).

**Response:** `200 OK`

#### POST /api/v1/tasks/:id/context-items/:itemId/refresh

Re-run extraction for a context item (useful for links and MCP references).

**Response:** `200 OK`

#### POST /api/v1/tasks/:id/context-items/:itemId/analyze

Trigger vision analysis for an image context item.

**Response:** `200 OK`

---

### Intake

#### POST /api/v1/intake/dismiss/:taskId

Dismiss an auto-detected task from the intake queue.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskId` | string | Task ID to dismiss |

**Response:** `200 OK`

```json
{
  "data": { "dismissed": true }
}
```

## Types

```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "done" | "replanning" | "blocked";
  priority: "low" | "medium" | "high" | "urgent" | null;
  source: "user" | "agent" | "routine";
  parentTaskId: string | null;
  subtasks?: Task[];
  createdAt: string;
  updatedAt: string;
}

interface TaskComment {
  id: string;
  content: string;
  userId: string;
  createdAt: string;
}

interface TaskStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  output: string | null;
  createdAt: string;
}

interface TaskReview {
  id: string;
  decision: "approved" | "changes_requested";
  feedback: string | null;
  userId: string;
  createdAt: string;
}

type TaskContextItemType = "note" | "link" | "file" | "image" | "text_block" | "mcp_reference";
type ExtractionStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

interface TaskContextItem {
  id: string;
  taskId: string;
  type: TaskContextItemType;
  label: string | null;
  rawValue: string;               // URL for links, filename for files, text for notes
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string | null;     // for file/image uploads
  extractedText: string | null;   // populated by async extraction pipeline
  extractedTitle: string | null;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  mcpIntegrationId: string | null;
  mcpResourceType: string | null; // "notion_page", "slack_thread"
  mcpResourceId: string | null;
  visionAnalysis: string | null;  // opt-in image description
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```
