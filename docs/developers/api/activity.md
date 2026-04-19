# Activity & Reactions

The activity feed provides a chronological stream of events across the platform, including task updates, chat activity, routine executions, and integration events. Users can react to activity entries with emoji reactions. The feed also surfaces proactive AI-generated signals and daily digests.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie).

## Endpoints

#### GET /api/v1/activity

List activity events using cursor-based pagination.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cursor` | string | No | Opaque cursor from a previous response |
| `limit` | number | No | Items per page (default: `50`) |
| `action` | string | No | Filter by action type (e.g., `"task.created"`, `"chat.message"`) |
| `userId` | string | No | Filter by user who performed the action |
| `since` | string | No | ISO 8601 timestamp to filter events after |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "activity_001",
      "action": "task.created",
      "userId": "user_abc",
      "userName": "Alice",
      "entityType": "task",
      "entityId": "task_abc123",
      "metadata": {
        "title": "Implement user onboarding flow",
        "priority": "high"
      },
      "createdAt": "2026-04-17T09:00:00Z"
    },
    {
      "id": "activity_002",
      "action": "routine.completed",
      "userId": null,
      "userName": "System",
      "entityType": "routine",
      "entityId": "routine_abc123",
      "metadata": {
        "name": "Daily Standup Summary",
        "duration": 4500
      },
      "createdAt": "2026-04-17T09:00:05Z"
    }
  ],
  "nextCursor": "eyJpZCI6ImFjdGl2aXR5XzAwMiJ9",
  "hasMore": true
}
```

---

#### GET /api/v1/activity/signals

Get proactive AI-generated signals. These are insights the agent surfaces based on patterns it detects across the team's activity. Results are cached for 4 hours.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "signal_001",
      "type": "blocker_detected",
      "title": "Potential blocker on Sprint 12",
      "description": "3 tasks assigned to Alice have been in_progress for over 5 days without updates.",
      "severity": "warning",
      "relatedEntities": [
        { "type": "task", "id": "task_001" },
        { "type": "task", "id": "task_002" },
        { "type": "task", "id": "task_003" }
      ],
      "createdAt": "2026-04-17T06:00:00Z"
    },
    {
      "id": "signal_002",
      "type": "positive_trend",
      "title": "Team velocity increasing",
      "description": "Task completion rate is up 20% compared to last week.",
      "severity": "info",
      "relatedEntities": [],
      "createdAt": "2026-04-17T06:00:00Z"
    }
  ]
}
```

---

#### GET /api/v1/activity/digest

Get an AI-generated digest summarizing recent activity.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hours` | number | No | Time window in hours (default: `24`) |

**Response:** `200 OK`

```json
{
  "data": {
    "summary": "In the last 24 hours, 8 tasks were completed, 3 new tasks were created, and 2 routines executed successfully. Notable: the onboarding flow was deployed to staging.",
    "highlights": [
      {
        "action": "task.completed",
        "description": "Implement user onboarding flow",
        "entityId": "task_abc123"
      },
      {
        "action": "routine.completed",
        "description": "Daily Standup Summary executed",
        "entityId": "routine_abc123"
      }
    ],
    "stats": {
      "tasksCreated": 3,
      "tasksCompleted": 8,
      "messagesExchanged": 47,
      "routinesExecuted": 2
    },
    "period": {
      "from": "2026-04-16T10:00:00Z",
      "to": "2026-04-17T10:00:00Z"
    }
  }
}
```

---

### Reactions

#### POST /api/v1/activity/:id/reactions

Add an emoji reaction to an activity event.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Activity event ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `emoji` | string | Yes | Emoji character or shortcode (e.g., `"thumbsup"`) |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "reaction_001",
    "activityId": "activity_001",
    "userId": "user_abc",
    "emoji": "thumbsup",
    "createdAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### DELETE /api/v1/activity/:id/reactions/:emoji

Remove an emoji reaction from an activity event.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Activity event ID |
| `emoji` | string | Emoji character or shortcode to remove |

**Response:** `200 OK`

```json
{
  "data": { "removed": true }
}
```

## Types

```typescript
interface ActivityEvent {
  id: string;
  action: string;
  userId: string | null;
  userName: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, any>;
  reactions?: Reaction[];
  createdAt: string;
}

interface ProactiveSignal {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  relatedEntities: { type: string; id: string }[];
  createdAt: string;
}

interface ActivityDigest {
  summary: string;
  highlights: {
    action: string;
    description: string;
    entityId: string;
  }[];
  stats: Record<string, number>;
  period: {
    from: string;
    to: string;
  };
}

interface Reaction {
  id: string;
  activityId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}
```
