# Hearth Cloud

Hearth Cloud is the managed deployment path for teams that want a hosted Hearth workspace instead of running the open-source stack themselves.

[[toc]]

## What Is Shared Across Editions

Hearth Cloud uses the same product concepts as self-hosted Hearth:

- Collaborative AI chat.
- Artifact generation and iteration.
- Agent-backed tasks and human review.
- Routines, triggers, state, and approval gates.
- Org, team, user, and session memory.
- Skills and skill governance.
- Activity feed and proactive signals.
- Decision graph and cognitive profiles.
- Integrations through built-in and MCP-backed connectors.
- Admin controls for users, teams, LLM providers, governance, compliance, analytics, and audit logs.

Read the shared [Product Guide](/guide/) for feature behavior and the [Admin Guide](/admin/) for workspace controls.

## What Is Cloud-Specific

Cloud docs focus on the responsibilities that differ from self-hosting:

- Workspace setup instead of infrastructure deployment.
- Hosted operations instead of Docker or Kubernetes management.
- Cloud security and data posture.
- Integration setup from a managed workspace.
- Billing, limits, and support policy.

## Cloud Setup Path

1. [Create and configure a workspace](/cloud/workspace-setup).
2. [Review security and data controls](/cloud/security-and-data).
3. [Connect integrations](/cloud/integrations).
4. [Invite users and teams](/admin/users-and-teams).
5. [Configure LLM providers](/admin/llm-providers).
6. [Turn on governance and compliance controls](/admin/governance).

## When to Self-Host Instead

Self-hosting is the better path when you need source-level customization, private network deployment, local model infrastructure, direct database control, or custom operational practices. See [Cloud vs Self-Hosted](/getting-started/comparison).
