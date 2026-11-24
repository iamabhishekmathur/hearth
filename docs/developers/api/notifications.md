# Notifications

Notifications are the items in the bell. Each one is stored as a `Notification` row and pushed to the person's socket room as `notification:new`.

All routes need a session. A person only ever sees and changes their own notifications and preferences.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/notifications?unreadOnly=&limit=` | Your latest notifications (default 30, max 100) and the unread count. |
| `POST` | `/notifications/:id/read` | Mark one as read. `404` if it is not yours or already read. |
| `POST` | `/notifications/read-all` | Mark all as read. |
| `GET` | `/notifications/preferences` | Your switches, with defaults filled in. |
| `PUT` | `/notifications/preferences` | Set any of your switches. |

## Preferences

```ts
interface NotificationPreferencesResponse {
  prefs: {
    knowledgeSummary: boolean;   // default true
    knowledgeEmail: boolean;     // default false
    adminWeeklySummary: boolean; // default true for admins, false for everyone else
    knowledgeImpact: boolean;    // default true
  };
  knowledgeLoop: boolean;        // the org flag; the UI hides the switches when false
}
```

| Switch | Controls |
|---|---|
| `knowledgeSummary` | The owner's line in the daily digest when Review cards wait, and the one 7-day reminder. |
| `knowledgeEmail` | Also email that line. The in-app item is always created. |
| `adminWeeklySummary` | Admins: the weekly card on Activity and the line in Monday's digest. |
| `knowledgeImpact` | The member line "Your input improved N things this week." With it off, `GET /knowledge/my-impact` returns `count: 0`. |

`PUT` takes any subset of these keys, booleans only, for example `{ "knowledgeEmail": true }`. Anything else — an unknown key, a non-boolean value, an array — gives `400` and changes nothing. The body is merged into what you stored before, and the response has your full, current switches.

Only the keys a person has set are stored (`notification_preferences.prefs`). A new switch gets its default without a backfill.

## The daily digest

The `activity-digest` worker runs every hour. For each person whose local time is 9am, it builds **one** `digest` notification from up to two parts:

1. **Activity:** the org's summary of the last 24 hours (as before).
2. **Knowledge** (only with the org flag `knowledgeLoop` on and `knowledgeSummary` on):
   - one line when cards wait for you — "3 proposals wait in Review", or "1 proposal for &lt;item&gt;" when they are all about one item;
   - the one reminder for each card that has waited 7 days ("Waiting a week: &lt;item&gt;", or "2 proposals have waited a week"). The card's `reminded_at` is then set, so it is never reminded again;
   - admins on Monday, with `adminWeeklySummary` on: one line such as "Knowledge this week: 3 changed · 2 wait (oldest 9 days) · 1 area has no owner".

Rules:

- Nothing to say → no notification.
- A person with both parts gets **one** notification. The knowledge lines come first in the body. When there is a knowledge line, `entityType` is `review` and the bell opens `#/review`; otherwise it is `org`.
- A second run in the same day (a job retry) sends nothing more.
- Timezone: `User.preferences.timezone` (IANA name). No timezone, or an invalid one, means **UTC**.
- Email (only when email is configured): the activity part is emailed as before. The knowledge lines are emailed only when `knowledgeEmail` is on. A failed email is logged and never stops the in-app item.
- Approving or rejecting a card sends no notification to anyone.

The digest logic lives in `apps/api/src/services/daily-digest.ts` (`runDailyDigest({ now, orgId, activityDigest })`). The worker runs it in the system job context, so it works under the production database role with row-level security.

## Types

```ts
type NotificationType =
  | "collaborator_added" | "mention" | "handoff" | "governance_block"
  | "comment_on_your_message" | "reaction_on_your_message"
  | "task_assigned" | "routine_result" | "digest";

interface NotificationItem {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  entityType: string | null;   // "review" opens the Review inbox
  entityId: string | null;
  sessionId: string | null;
  readAt: string | null;
  createdAt: string;
}
```
