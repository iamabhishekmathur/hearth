# Growth Funnel Events

The product-funnel event taxonomy for Hearth's growth loop (activation →
retention → referral). This is the **single source of truth** for event names
and payloads. The compiler enforces the payload contracts via
`apps/web/src/lib/analytics-events.ts`.

## How instrumentation works

Analytics is **gated and dev-safe**. It is a complete no-op unless a key is
configured, so local dev, CI, and unit tests are never affected and never make
network calls.

- **Client** (`apps/web/src/lib/analytics.ts`): wraps `posthog-js`. Initializes
  only when `VITE_POSTHOG_KEY` is set. Exports `track`, `identify`, `reset`,
  `initAnalytics`. Optional `VITE_POSTHOG_HOST` (defaults to PostHog US cloud).
- **Server** (`apps/api/src/lib/analytics.ts`): wraps `posthog-node`. Initializes
  only when `POSTHOG_API_KEY` is set. Exports `capture`, `shutdownAnalytics`.
  Optional `POSTHOG_HOST`. Reads `process.env` directly (not the zod config) so
  it stays self-contained.
- **Typed emit** (`apps/web/src/lib/analytics-events.ts`): call sites use
  `trackEvent(AnalyticsEvent.X, props)` — never raw strings, never `posthog-js`
  directly. `identify`/`reset` are called from `use-auth.ts`.

To enable in an environment, set the keys; nothing else changes.

## Identity

| Action | Where | Call |
| --- | --- | --- |
| Login / register / session hydrate / refresh | `apps/web/src/hooks/use-auth.ts` | `identify(userId, { email, name, role, org_id, team_id })` |
| Logout | `apps/web/src/hooks/use-auth.ts` | `reset()` |

`distinctId` on the server (`capture`) MUST equal the client `identify` id (the
user id) so client and server events stitch onto one person.

## Event taxonomy

| Event | Constant | Stage | Payload | Status | Emitted from |
| --- | --- | --- | --- | --- | --- |
| `user_signed_up` | `USER_SIGNED_UP` | Activation | `{ method: 'register' \| 'setup', orgName? }` | **Live** | `use-auth.ts` (register), `pages/setup-wizard.tsx` (first-admin setup) |
| `first_message_sent` | `FIRST_MESSAGE_SENT` | Activation | `{ sessionId, length, hasAttachments? }` | **Live** | `use-chat.ts` `sendMessage` (post-send success) |
| `integration_connected` | `INTEGRATION_CONNECTED` | Activation | `{ provider, kind: 'builtin' \| 'custom' }` | **Live** | `components/admin/integration-health.tsx` (both connect handlers) |
| `first_task_created` | `FIRST_TASK_CREATED` | Activation | `{ taskId?, source }` | **Live** | `use-tasks.ts` `createTask` |
| `routine_created` | `ROUTINE_CREATED` | Retention | `{ routineId?, triggerType?, scope? }` | **Live** | `use-routines.ts` `createRoutine` |
| `aha_reached` | `AHA_REACHED` | Activation | `{ via, provider? }` | **Deferred** | P1 — integration-pull aha (server-side `capture` from the tool path, or client when a pulled-context result renders) |
| `onboarding_step_completed` | `ONBOARDING_STEP_COMPLETED` | Activation | `{ step, stepIndex? }` | **Deferred** | P1 — wire from the onboarding UI as Track 1's step transitions land |
| `invite_sent` | `INVITE_SENT` | Referral | `{ count, context? }` | **Deferred** | P2 — contextual-first invite flow (UI not built yet) |
| `invite_accepted` | `INVITE_ACCEPTED` | Referral | `{ inviteId? }` | **Deferred** | P3 — server-side `capture` on invite acceptance (no UI surface) |

### Live now

`USER_SIGNED_UP`, `FIRST_MESSAGE_SENT`, `INTEGRATION_CONNECTED`,
`FIRST_TASK_CREATED`, `ROUTINE_CREATED` — plus `identify`/`reset`.

### Defined but deferred (no call site today)

`AHA_REACHED`, `ONBOARDING_STEP_COMPLETED`, `INVITE_SENT`, `INVITE_ACCEPTED`.
These are defined in the taxonomy so later phases can emit them without redefining
names or payloads. `AHA_REACHED` is the integration-pull aha; `INVITE_*` belong to
the contextual-first referral loop.

## Conventions

- **Never** put message bodies, credentials, or PII beyond what's listed in
  identity traits into event payloads. Lengths/counts only for content signals.
- Event names are `snake_case` and **stable** — renaming breaks historical
  funnels in PostHog. Add new events; don't repurpose old ones.
- "First*" events (`first_message_sent`, `first_task_created`) emit on **every**
  occurrence today; first-touch semantics are derived in PostHog via funnels /
  first-time filters rather than client-side de-duplication.
