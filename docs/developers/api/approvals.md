# Approvals

Approvals provide a human-in-the-loop checkpoint for agent actions that require user review before execution. When the agent performs a high-impact action (e.g., sending an external message, modifying production data), it creates an approval request and waits for a human decision.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

#### GET /api/v1/approvals

List pending approval requests for the current user.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "approval_abc123",
      "type": "tool_execution",
      "description": "Send Slack message to #engineering channel",
      "agentContext": "During routine 'Daily Standup Summary', the agent wants to post the standup report.",
      "proposedOutput": "Good morning team! Here's the standup summary for 2026-04-17...",
      "status": "pending",
      "taskId": "task_xyz",
      "routineId": "routine_abc123",
      "createdAt": "2026-04-17T09:00:00Z"
    },
    {
      "id": "approval_def456",
      "type": "tool_execution",
      "description": "Create GitHub issue in hearth/core",
      "agentContext": "User asked the agent to file a bug report based on the conversation.",
      "proposedOutput": "Title: Fix login redirect loop\nBody: When a user...",
      "status": "pending",
      "taskId": null,
      "routineId": null,
      "createdAt": "2026-04-17T09:30:00Z"
    }
  ]
}
```

---

#### GET /api/v1/approvals/:id

Get a single approval request with full details.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Approval ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "approval_abc123",
    "type": "tool_execution",
    "description": "Send Slack message to #engineering channel",
    "agentContext": "During routine 'Daily Standup Summary', the agent wants to post the standup report.",
    "proposedOutput": "Good morning team! Here's the standup summary for 2026-04-17...",
    "status": "pending",
    "taskId": "task_xyz",
    "routineId": "routine_abc123",
    "createdAt": "2026-04-17T09:00:00Z"
  }
}
```

---

#### POST /api/v1/approvals/:id/resolve

Resolve an approval request by approving, rejecting, or editing the proposed output.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Approval ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `decision` | string | Yes | `"approved"`, `"rejected"`, or `"edited"` |
| `comment` | string | No | Reviewer comment explaining the decision |
| `editedOutput` | string | No | Modified output (required when decision is `"edited"`) |

**Response:** `200 OK`

Approve the action as proposed:

```json
{
  "data": {
    "id": "approval_abc123",
    "status": "approved",
    "decision": "approved",
    "comment": "Looks good, send it.",
    "resolvedBy": "user_abc",
    "resolvedAt": "2026-04-17T09:05:00Z"
  }
}
```

Reject the action:

```json
{
  "data": {
    "id": "approval_def456",
    "status": "rejected",
    "decision": "rejected",
    "comment": "Not the right channel for this message.",
    "resolvedBy": "user_abc",
    "resolvedAt": "2026-04-17T09:35:00Z"
  }
}
```

Approve with edits:

```json
{
  "data": {
    "id": "approval_abc123",
    "status": "approved",
    "decision": "edited",
    "comment": "Fixed the formatting.",
    "editedOutput": "Good morning team! Here's the updated standup summary...",
    "resolvedBy": "user_abc",
    "resolvedAt": "2026-04-17T09:06:00Z"
  }
}
```

## Approval Flow

1. The agent initiates a high-impact action and creates an approval request.
2. The user is notified in real-time via WebSocket (`approval:pending` event).
3. The user reviews the proposed output and resolves the approval.
4. On `"approved"` or `"edited"`, the agent proceeds with execution (using edited output if provided).
5. On `"rejected"`, the agent aborts the action and reports the rejection.

## Types

```typescript
interface Approval {
  id: string;
  type: string;
  description: string;
  agentContext: string;
  proposedOutput: string;
  status: "pending" | "approved" | "rejected";
  decision?: "approved" | "rejected" | "edited";
  comment?: string;
  editedOutput?: string;
  taskId: string | null;
  routineId: string | null;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}
```
