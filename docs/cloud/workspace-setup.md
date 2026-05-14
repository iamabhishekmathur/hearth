# Cloud Workspace Setup

This page covers the managed-cloud onboarding flow. For Docker or Kubernetes setup, use the [self-hosting docs](/self-hosting/).

[[toc]]

## Initial Workspace

1. Create a new Hearth Cloud workspace or accept an invitation.
2. Complete the first admin account setup.
3. Confirm the workspace and organization name.
4. Open the admin settings.
5. Invite the initial users and assign roles.

## Configure LLM Providers

Hearth needs at least one model provider to power chat, routines, memory synthesis, task planning, and agent execution.

From **Settings > LLM Config**:

1. Choose the provider your organization wants to use.
2. Enter or confirm provider credentials.
3. Test the connection.
4. Select the default model.
5. Confirm whether vision support should be enabled.

See [LLM Providers](/admin/llm-providers) for the shared admin reference.

## Invite Users and Teams

From **Settings > Users** and **Settings > Teams**:

- Invite or create users.
- Assign roles: admin, team lead, member, or viewer where available.
- Create teams that match how your organization actually shares context.
- Add users to teams before relying on team-scoped memory.

See [Users and Teams](/admin/users-and-teams).

## Connect Integrations

Start with the systems Hearth should use on day one:

- Slack for communication, channel context, and delivery.
- Google Calendar for meeting context and scheduling.
- Gmail or Google Drive for inbox and document context.
- Jira or GitHub for execution workflows.
- Notion for internal knowledge and workspace docs.

See [Cloud Integrations](/cloud/integrations) and [Admin Integrations](/admin/integrations).

## Configure Guardrails

Before broad rollout:

1. Review [Governance](/admin/governance) and create any monitor, warn, or block policies.
2. Review [Compliance](/admin/compliance) and enable the packs your organization needs.
3. Confirm audit log and analytics access with admins.
4. Review sharing behavior for collaborative chat sessions.
5. Decide whether cognitive profiles should be enabled.

## First Rollout

Start with a small group and a concrete workflow:

- A recurring meeting prep routine.
- A PR or issue digest.
- A support-feedback summary.
- A launch-readiness checklist.

After the pilot, expand integrations and invite more teams.
