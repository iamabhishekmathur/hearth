# Governance

Control what the AI can and cannot do with policies, approval workflows, and skill governance. Requires the **admin** role.

## Overview

Governance gives admins fine-grained control over AI behavior across the organization. It includes three pillars: policy enforcement (rules that check messages for prohibited content), skill governance (approving or blocking AI capabilities), and violation tracking (monitoring and reviewing policy breaches). Policies can block user messages before they reach the AI or flag AI responses after generation.

## Key Concepts

- **Policy** -- A named rule that checks message content against defined criteria. Each policy has a rule type, severity, enforcement mode, and scope.
- **Rule Types** -- Three ways to define what a policy detects:
  - **keyword** -- Matches exact keywords or phrases in message content.
  - **regex** -- Matches a regular expression pattern against message content.
  - **llm_evaluation** -- Uses an LLM to evaluate whether content violates the policy (more flexible but higher latency).
- **Enforcement** -- Determines what happens when a policy is triggered:
  - **monitor** -- The violation is logged silently for admin review. The user is not notified.
  - **warn** -- The violation is logged and the user sees a warning banner on the flagged message. The message is still sent to the AI.
  - **block** -- The message is stopped and not sent to the AI. The user receives a `governance:blocked` WebSocket event with the policy name, severity, and reason. The API returns HTTP 403.
- **Severity** -- Policies are categorized by severity: `info`, `warning`, or `critical`. This helps admins prioritize violations during review. Critical violations get a red accent in the dashboard.
- **Scope** -- Policies can target:
  - **User messages** -- Checked before sending to the LLM. Blocking policies can prevent the request entirely.
  - **AI responses** -- Checked after the LLM generates a response. Non-blocking; violations are logged but the response is delivered.
- **Violation** -- A recorded instance of a policy being triggered. Violations include the policy name, the flagged content, the user, and a timestamp.
- **Skill Governance** -- Separate from message policies. Admins approve or reject skill proposals and maintain blocklists to control which skills are available to the organization.
- **Governance Settings** -- Organization-level toggles that control the overall governance system: enable/disable governance, toggle user message checking, toggle AI response checking, admin notifications, and the monitoring banner.

## How It Works

Governance operates as a defense-in-depth system with three layers:

1. **System prompt injection** — When governance is enabled, active policy descriptions are automatically injected into the AI's system prompt. This makes the AI proactively refuse to help with policy violations before they happen. For example, if a "No PII Sharing" policy exists, the AI will decline requests to share personal information and explain which guideline applies.

2. **Message evaluation** — Every user message (and optionally AI responses) is evaluated against all enabled policies. Keyword and regex rules run in-process in microseconds. LLM evaluation rules use a cheap model (Haiku) for cost-efficient semantic analysis. Evaluation is asynchronous for monitor/warn policies (non-blocking) and synchronous for block policies.

3. **Violation tracking and review** — Detected violations are persisted to the database, logged to the audit trail (visible in the activity feed), and pushed to admins via real-time WebSocket notifications. Admins can review, acknowledge, dismiss, or escalate violations. All review actions are themselves audited.

**Per-team/per-user scoping** — Policies can be scoped to specific teams or users. An empty scope (default) applies to all users in the org.

**Monitoring banner** — When enabled, a subtle banner appears in the chat interface informing users that governance monitoring is active. This promotes self-regulation.

## How To

### Enable governance

1. Go to **Settings > Governance** (or use the API).
2. Toggle governance **on** for your organization.
3. Configure the high-level settings:
   - **Check user messages** -- Evaluate user messages before they are sent to the AI.
   - **Check AI responses** -- Evaluate AI responses after generation.
   - **Notify admins** -- Send notifications when violations occur.
   - **Monitoring banner** -- Show users a banner indicating that governance monitoring is active.
4. Click **Save**.

### Create a policy

1. Navigate to the governance policies section.
2. Click **Create Policy**.
3. Fill in the policy details:
   - **Name** -- A descriptive name (e.g., "No PII sharing", "Block competitor mentions").
   - **Description** -- What the policy is intended to prevent.
   - **Category** -- Optional grouping for organizational purposes.
   - **Severity** -- `info`, `warning`, or `critical`.
   - **Rule type** -- `keyword`, `regex`, or `llm_evaluation`.
   - **Rule config** -- The matching criteria (keywords list, regex pattern, or evaluation prompt).
   - **Enforcement** -- `monitor` (logs only), `warn` (logs and notifies user), or `block` (stops the message).
   - **Scope** -- Which teams or users the policy applies to (empty = all users).
4. Click **Save**. The policy takes effect immediately.

### Test a policy

1. Use the policy test endpoint to dry-run a rule against sample text before deploying it.
2. Send a POST request to `/api/v1/admin/governance/policies/test` with:
   - `ruleType` -- The rule type to test.
   - `ruleConfig` -- The matching configuration.
   - `sampleMessage` -- The text to evaluate.
3. The response shows whether any violations would be triggered and their details.

### Review violations

1. Navigate to the governance violations section.
2. View the list of recorded violations, filtered by severity, status, user, or policy.
3. Click a violation to see its full details: the flagged content, which policy triggered it, the user, and the timestamp.
4. Take action on each violation:
   - **Acknowledge** -- Mark it as reviewed.
   - **Dismiss** -- Mark it as a false positive or non-issue.
   - **Escalate** -- Flag it for further review (requires a note explaining why).

### View governance statistics

1. Use the stats endpoint to get an overview of violation counts and trends.
2. GET `/api/v1/admin/governance/stats?since=2026-01-01` returns aggregated violation data.

### Export violations

1. GET `/api/v1/admin/governance/export?format=csv` to download violations as a CSV file.
2. Supports `format=csv` or `format=json`.
3. Filter by date range using `since` and `until` query parameters.

### Govern skills

1. Go to **Settings > Skills**.
2. View all skills in the catalog with their status and usage metrics.
3. Approve or reject skill proposals to control which skills are available to the organization.
4. Block skills that are inappropriate or no longer needed.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/governance/settings` | Get governance settings |
| PUT | `/api/v1/admin/governance/settings` | Update governance settings |
| GET | `/api/v1/admin/governance/policies` | List all policies |
| POST | `/api/v1/admin/governance/policies` | Create a new policy |
| GET | `/api/v1/admin/governance/policies/:id` | Get a single policy |
| PUT | `/api/v1/admin/governance/policies/:id` | Update a policy |
| DELETE | `/api/v1/admin/governance/policies/:id` | Delete a policy |
| POST | `/api/v1/admin/governance/policies/test` | Dry-run a rule against sample text |
| GET | `/api/v1/admin/governance/violations` | List violations (filterable, paginated) |
| GET | `/api/v1/admin/governance/violations/:id` | Get a single violation |
| PATCH | `/api/v1/admin/governance/violations/:id` | Review a violation (acknowledge, dismiss, escalate) |
| GET | `/api/v1/admin/governance/stats` | Get violation statistics |
| GET | `/api/v1/admin/governance/export` | Export violations as CSV or JSON |

## Tips

- Start with **monitor** enforcement to understand what would be flagged before switching to **warn** or **block**. This avoids disrupting users while you tune your rules.
- Use the `keyword` rule type for simple, exact-match scenarios (e.g., specific terms like "password" or competitor names). Use `regex` for pattern-based matching (e.g., SSN patterns like `\b\d{3}-\d{2}-\d{4}\b`). Reserve `llm_evaluation` for nuanced semantic checks that require understanding context.
- When a **block** policy triggers on a user message, the API returns HTTP 403 and the user receives a `governance:blocked` WebSocket event containing the `policyName`, `severity`, and `reason`. The frontend displays this as a blocked message indicator.
- When a **warn** policy triggers, the message still goes through to the AI, but the user sees a warning indicator on the flagged message.
- Review violations regularly. The violations list supports filtering by severity, status, user, and policy, making it easy to focus on high-priority items.
- The monitoring banner is optional but recommended for transparency. When enabled, users see an indicator that governance monitoring is active.
- Export violations periodically for compliance reporting. Both CSV and JSON formats are available.

## Related

- [Approvals](/guide/#approvals) -- Approval workflows complement governance by requiring human sign-off before certain AI actions execute.
- [Skills](/guide/#chat) -- Skill governance is managed alongside message policies.
- [Compliance](./compliance) -- Compliance controls handle data retention and sensitive data scrubbing.
- [Audit Logs](./audit-logs) -- All governance actions (policy changes, violation reviews) are recorded in the audit trail.
