# Start with Hearth Cloud

Hearth Cloud is the managed path for teams that want the Hearth product experience without operating the infrastructure themselves.

[[toc]]

## What Hearth Cloud Handles

In the cloud edition, Hearth runs and maintains the application infrastructure for your workspace:

- Web app, API, background workers, queues, and real-time services.
- Database and cache operations.
- Application updates and platform maintenance.
- Hosted ingress, TLS, and availability work.
- Operational monitoring for the hosted service.

Your team still configures the workspace itself: users, teams, integrations, LLM provider behavior, governance, compliance settings, and routines.

## Workspace Setup

1. Create a Hearth Cloud workspace or accept an invitation from an existing workspace.
2. Create the first admin account.
3. Confirm the organization name and workspace settings.
4. Configure the default LLM provider behavior.
5. Invite team members and assign roles.
6. Connect integrations that the team expects Hearth to use.
7. Review governance, compliance, audit, and sharing controls before broad rollout.

For the full admin flow, see [Cloud Workspace Setup](/cloud/workspace-setup).

## First Chat

Open **Chat**, start a new session, and ask Hearth to produce a concrete team artifact: a launch checklist, meeting brief, support triage summary, or project plan. Then use the task button to promote follow-up work to the task board.

## First Routine

Open **Routines** and start with a low-risk recurring workflow:

- Daily standup summary.
- Weekly PR review digest.
- Meeting prep from calendar and docs.
- Support feedback roundup.

Connect the delivery integration first if the routine should post to Slack, create Jira tickets, or update a Notion page.

## Admin Next Steps

- [Users and Teams](/admin/users-and-teams)
- [Integrations](/admin/integrations)
- [LLM Providers](/admin/llm-providers)
- [Governance](/admin/governance)
- [Compliance](/admin/compliance)
- [Cloud Security and Data](/cloud/security-and-data)

## When to Use Self-Hosting Instead

Choose the self-hosted path when your team needs to run Hearth in its own network, modify the source, connect private infrastructure, operate with local models, or own every operational control directly. See [Start Self-Hosted](/getting-started/self-hosted).
