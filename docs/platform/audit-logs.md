# Audit Logs

Comprehensive audit trail of all significant platform actions. Requires the **admin** role.

## Overview

Audit Logs record every significant action taken on the Hearth platform -- user authentication, role changes, integration connections, skill installations, governance violations, compliance scrubbing, and more. Admins can filter, search, and paginate through the log to investigate incidents, demonstrate compliance, or understand platform usage patterns. Logs are scoped to your organization and retained according to your compliance configuration.

## Key Concepts

- **Audit Event** -- A single logged action. Each event records the timestamp, the actor (user who performed the action), the action type, the entity affected, and additional details.
- **Action Types** -- The categories of events that are logged:
  - `auth_login` / `auth_register` / `auth_logout` -- Authentication events
  - `session_created` -- New chat session started
  - `task_status_change` / `task_completed` -- Task lifecycle events
  - `skill_install` / `skill_uninstall` / `skill_published` -- Skill catalog changes
  - `integration_connect` / `integration_disconnect` -- Integration lifecycle
  - `routine_run` -- Routine execution events
  - `llm_call` -- AI model invocations
  - `tool_call` -- Tool executions during conversations
  - `compliance_scrub` -- Sensitive data scrubbing events
  - `governance_violation` -- Policy violation detections
  - `governance_policy_change` -- Governance policy modifications
- **Entity Types** -- The type of object affected by an action:
  - `session`, `task`, `routine`, `skill`, `memory`, `integration`, `user`, `governance_policy`, `governance_violation`
- **Pagination** -- Results are paginated with configurable page size (default: 50 entries per page).
- **Feed-Worthy Actions** -- A subset of audit events are also emitted in real time via WebSocket to the organization room, appearing in the [Activity Feed](/guide/#activity-feed).

## How To

### View audit logs

1. Go to **Settings > Audit Logs** (admin role required).
2. The log displays a chronological list of events with timestamp, actor, action, and entity details.
3. Scroll through the list or use page controls to navigate.

### Filter audit logs

1. On the audit logs page, use the filter controls at the top.
2. Available filters:
   - **User** -- Show only events from a specific user.
   - **Action type** -- Filter by action (e.g., show only `auth_login` events or only `governance_violation` events).
   - **Entity type** -- Filter by the type of object affected (e.g., `integration`, `skill`).
3. Apply the filters. The list updates to show only matching events.

### Investigate a specific event

1. Find the event in the audit log list.
2. Click on it to expand the full details, including the `details` JSON payload with action-specific data.
3. For example, an `integration_connect` event might include the provider name and connection status, while a `compliance_scrub` event includes entity counts and pack IDs.

### Query audit logs via API

```
GET /api/v1/admin/audit-logs?userId=abc&action=auth_login&entityType=user&page=1&pageSize=50
```

All query parameters are optional. Without filters, the endpoint returns the most recent events paginated.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/audit-logs` | Query audit logs with optional filters and pagination |

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Filter by the user who performed the action |
| `action` | string | Filter by action type (e.g., `auth_login`, `skill_install`) |
| `entityType` | string | Filter by entity type (e.g., `user`, `integration`, `skill`) |
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Results per page (default: 50) |

## Tips

- Use audit logs to investigate security incidents. Filter by `auth_login` to see all login attempts, or by a specific user ID to trace all their actions.
- Combine action and entity type filters for targeted searches. For example, filter by action `integration_connect` and entity type `integration` to see all integration setup events.
- Audit logs are append-only. Events cannot be modified or deleted through the application, ensuring the integrity of the trail.
- For compliance reporting, export audit data through the API. Query with date-based filters and page through all results programmatically.
- Feed-worthy audit events also appear in the real-time [Activity Feed](/guide/#activity-feed), so your team sees important actions as they happen without needing to visit the audit logs page.
- Retention of audit logs is configurable through [Compliance](./compliance) settings. Ensure your retention period meets your regulatory requirements.

## Related

- [Compliance](./compliance) -- Configure data retention policies that affect how long audit logs are kept. Compliance scrubbing events appear in the audit trail.
- [Governance](./governance) -- Governance policy changes and violations are recorded as audit events.
- [Analytics](./analytics) -- Analytics provides aggregated metrics; audit logs provide the granular event-level detail.
- [Activity Feed](/guide/#activity-feed) -- A real-time, user-facing subset of audit events.
