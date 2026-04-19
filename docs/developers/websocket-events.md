# WebSocket Events Reference

Hearth uses Socket.io for real-time communication between the web client and the API server. All WebSocket connections are authenticated using the same HTTP-only session cookie as the REST API. Unauthenticated sockets are rejected during the handshake.

**Source:** `apps/api/src/ws/socket-manager.ts`

## Connection

```typescript
import { io } from "socket.io-client";

const socket = io("https://your-hearth-instance.com", {
  withCredentials: true, // sends the session cookie
});

socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("connect_error", (err) => {
  // err.message === "Unauthorized" when session is missing/expired
  console.error("Connection failed:", err.message);
});
```

The server shares the Express session middleware with Socket.io via `io.engine.use(sessionMiddleware)`. On connection, the middleware extracts `session.userId` from the cookie. If no valid session exists, the socket receives a `connect_error` with message `"Unauthorized"`.

---

## Room Management

Rooms scope event delivery so clients only receive events relevant to the resources they are viewing. Each resource type has its own room namespace.

### Room Join Events (Client -> Server)

| Event | Payload | Description |
|---|---|---|
| `join:session` | `sessionId: string` | Join a chat session room. Server verifies the user is the owner, a collaborator, or the session is org-visible. On success, triggers presence tracking. |
| `leave:session` | `sessionId: string` | Leave a chat session room. Cleans up presence tracking and broadcasts `presence:leave` if the user has no other sockets in the room. |
| `join:task` | `taskId: string` | Join a task room for real-time task updates. Server verifies the user owns the task. |
| `leave:task` | `taskId: string` | Leave a task room. |
| `join:org` | `orgId: string` | Join an organization room for the activity feed. Server verifies the user belongs to the org (via team membership). |
| `leave:org` | `orgId: string` | Leave an organization room. |

The `user:{userId}` room is joined automatically on connection -- no client action required. This room is used for user-scoped notifications.

### Access Control

- **Session rooms:** The `getSession` function checks three access paths: (1) session owner, (2) listed as a `SessionCollaborator`, (3) session visibility is `"org"` and user belongs to the same org.
- **Task rooms:** Only the task owner (`task.userId === socket.userId`) can join.
- **Org rooms:** The user must belong to a team within the org.

---

## Session-Scoped Events (Server -> Client)

These events are emitted to the `session:{sessionId}` room. Join the session room first to receive them.

### `agent:event`

The primary event for streaming agent responses. Carries a `ChatEvent` object with a `type` discriminator.

| ChatEvent Type | Payload Fields | Description |
|---|---|---|
| `text_delta` | `content: string` | A chunk of streaming text from the agent. Concatenate all deltas to build the full response. |
| `thinking` | `content: string` | Extended thinking content (when the model uses chain-of-thought). |
| `tool_call_start` | `id: string, tool: string` | A tool call has begun. `id` is the unique tool call ID, `tool` is the tool name (e.g., `"web_search"`). |
| `tool_call_delta` | `id: string, input: string` | A chunk of the tool call's JSON input. Accumulate by `id` and parse when `tool_call_end` arrives. |
| `tool_call_end` | `id: string` | The tool call input is complete. The tool will now execute. |
| `tool_progress` | `toolCallId: string, toolName: string, status: "started" \| "completed" \| "failed", durationMs?: number` | Progress update for tool execution. `started` is emitted before execution begins; `completed` or `failed` after. |
| `error` | `message: string` | An error occurred during the agent loop. The loop terminates after this event. |
| `done` | `usage: { inputTokens: number, outputTokens: number }` | The agent loop has finished. Contains token usage statistics for the run. |

### `artifact:created`

Emitted when the agent creates a new artifact in the session.

```typescript
{
  id: string;
  sessionId: string;
  type: "code" | "document" | "diagram" | "table" | "html" | "image";
  title: string;
  content: string;
  language?: string;
  version: number;
  createdBy: string;
  createdAt: string;
}
```

### `artifact:updated`

Emitted when the agent updates an existing artifact.

```typescript
{
  id: string;
  sessionId: string;
  type: "code" | "document" | "diagram" | "table" | "html" | "image";
  title: string;
  content: string;
  language?: string;
  version: number;       // incremented on each update
  createdBy: string;
  updatedAt: string;
}
```

### `artifact:deleted`

Emitted when an artifact is removed from the session.

```typescript
{
  artifactId: string;
}
```

### `governance:blocked`

Emitted when a governance policy blocks a message or action.

```typescript
{
  messageId: string;
  policyName: string;
  severity: "info" | "warning" | "critical";
  reason: string;
}
```

### Presence Events

Presence is tracked per session room. When a user joins or leaves, all other members of the room are notified.

| Event | Payload | Description |
|---|---|---|
| `presence:join` | `{ userId: string, name: string }` | A user joined the session room. Broadcast to all *other* members. |
| `presence:leave` | `{ userId: string, name: string }` | A user left the session room. Only fires when the user's *last* socket leaves (handles multi-tab). |
| `presence:list` | `[{ userId: string, name: string }, ...]` | Sent to the joining user immediately after `join:session`. Contains the deduplicated list of all current members. |

Presence deduplication: a user with multiple tabs/sockets in the same room appears once in `presence:list`. The `presence:leave` event only fires when all of that user's sockets have left or disconnected.

---

## Task-Scoped Events (Server -> Client)

These events are emitted to the `task:{taskId}` room.

### `task:event`

A wrapper event for all task-related updates.

```typescript
{
  type: "task:updated" | "task:comment" | "task:review" | "task:subtask";
  data: Record<string, unknown>;
}
```

| Type | Data | Description |
|---|---|---|
| `task:updated` | Task object fields | Task status, title, description, or priority changed. |
| `task:comment` | `{ taskId, commentId, content, isAgent, createdAt }` | A new comment was added to the task. |
| `task:review` | `{ taskId, reviewId, decision, feedback }` | A review decision was submitted. |
| `task:subtask` | `{ taskId, subtaskId, title, status }` | A subtask was created or updated. |

---

## User-Scoped Events (Server -> Client)

These events are emitted to the `user:{userId}` room, which is joined automatically on connection.

### `collaborator:added`

Notifies a user that they were added as a collaborator on a session.

```typescript
{
  sessionId: string;
  sessionTitle: string;
  addedByName: string;
  role: "viewer" | "contributor";
}
```

---

## Org-Scoped Events (Server -> Client)

These events are emitted to the `org:{orgId}` room for the activity feed.

Events emitted to org rooms use the `emitToOrg(orgId, eventName, payload)` helper. The specific event names depend on the activity feed service, but follow the pattern of audit log entries broadcast to all org members.

---

## Decision Events

Decision events are broadcast to the `org:{orgId}` room. Clients receive these after joining an org room.

### `decision:created`

Emitted when a new decision is captured (manual or auto-detected).

```typescript
{
  id: string;        // decision ID
  title: string;     // decision title
  domain: string;    // domain category
  scope: string;     // org | team | personal
  userId: string;    // who captured it
}
```

### `decision:outcome_updated`

Emitted when an outcome is recorded for a decision.

```typescript
{
  id: string;             // decision ID
  title: string;          // decision title
  outcomeSnippet: string; // first 100 chars of outcome description
  updatedBy: string;      // user ID
}
```

### `decision:validated`

Emitted when a draft decision is confirmed by a reviewer.

```typescript
{
  id: string;          // decision ID
  validatedBy: string; // user ID
}
```

### `decision:pattern_updated`

Emitted when a decision pattern is created or updated (nightly job).

```typescript
{
  patternId: string;     // pattern ID
  domain: string;        // domain category
  patternName: string;   // pattern name
  decisionCount: number; // supporting decision count
}
```

### `decision:principle_updated`

Emitted when an organizational principle is created or updated.

```typescript
{
  principleId: string; // principle ID
  domain: string;      // domain category
  principle: string;   // principle title
  version: number;     // version number
}
```

### `decision:suggestion` (user-scoped)

Emitted to the `user:{userId}` room when a low-confidence decision is auto-detected and needs review.

```typescript
{
  extractedDecision: Decision; // the draft decision object
  sessionId: string;           // chat session where it was detected
}
```

---

## Server-Side Emit Helpers

The socket manager exports several helper functions used throughout the backend to emit events:

| Function | Signature | Description |
|---|---|---|
| `emitToSession` | `(sessionId: string, event: ChatEvent) => void` | Emits `agent:event` to all clients in a session room. |
| `emitToSessionEvent` | `(sessionId: string, eventName: string, payload: Record<string, unknown>) => void` | Emits a named event (e.g., `artifact:created`) to a session room. |
| `emitToTask` | `(taskId: string, event: Record<string, unknown>) => void` | Emits `task:event` to all clients in a task room. |
| `emitToUser` | `(userId: string, eventName: string, event: Record<string, unknown>) => void` | Emits a named event to a specific user across all their connected sockets. |
| `emitToOrg` | `(orgId: string, eventName: string, event: Record<string, unknown>) => void` | Emits a named event to all members of an org. |

---

## Usage Examples

### Listening to Agent Streaming

```typescript
const socket = io("https://your-hearth-instance.com", {
  withCredentials: true,
});

// Join a session room
socket.emit("join:session", sessionId);

// Build the response incrementally
let responseText = "";
const activeToolCalls = new Map<string, { tool: string; input: string }>();

socket.on("agent:event", (event) => {
  switch (event.type) {
    case "text_delta":
      responseText += event.content;
      updateUI(responseText);
      break;

    case "tool_call_start":
      activeToolCalls.set(event.id, { tool: event.tool, input: "" });
      showToolCallIndicator(event.tool);
      break;

    case "tool_call_delta":
      const tc = activeToolCalls.get(event.id);
      if (tc) tc.input += event.input;
      break;

    case "tool_call_end":
      // Tool input is now complete; execution begins
      break;

    case "tool_progress":
      if (event.status === "completed") {
        hideToolCallIndicator(event.toolName);
      }
      break;

    case "error":
      showError(event.message);
      break;

    case "done":
      console.log(
        `Tokens used: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`
      );
      break;
  }
});
```

### Tracking Presence in a Session

```typescript
socket.emit("join:session", sessionId);

const members = new Map<string, string>(); // userId -> name

socket.on("presence:list", (list) => {
  // Initial member list on join
  for (const member of list) {
    members.set(member.userId, member.name);
  }
  renderMemberList(members);
});

socket.on("presence:join", ({ userId, name }) => {
  members.set(userId, name);
  renderMemberList(members);
});

socket.on("presence:leave", ({ userId }) => {
  members.delete(userId);
  renderMemberList(members);
});
```

### Watching Task Updates

```typescript
socket.emit("join:task", taskId);

socket.on("task:event", (event) => {
  switch (event.type) {
    case "task:updated":
      refreshTaskCard(event.data);
      break;
    case "task:comment":
      appendComment(event.data);
      break;
    case "task:review":
      showReviewDecision(event.data);
      break;
  }
});

// Clean up when navigating away
socket.emit("leave:task", taskId);
```

### Error Handling

```typescript
socket.on("error", (err) => {
  // Server-side errors (e.g., failed room join, invalid IDs)
  console.error("Socket error:", err.message);
});

socket.on("disconnect", (reason) => {
  // reason: "io server disconnect", "transport close", etc.
  if (reason === "io server disconnect") {
    // Server forcefully disconnected — session may have expired
    socket.connect(); // attempt reconnect
  }
});
```
