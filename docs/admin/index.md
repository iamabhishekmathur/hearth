# Admin Guide

The admin guide covers workspace controls shared by Hearth Cloud and self-hosted Hearth. Cloud admins configure the managed workspace. Self-hosted admins do the same product configuration, while operators also manage deployment, storage, secrets, backups, and upgrades.

[[toc]]

## Admin Areas

| Area | Purpose |
|---|---|
| [Users and Teams](/admin/users-and-teams) | Accounts, roles, teams, access, and team context. |
| [Integrations](/admin/integrations) | Slack, Gmail, Google Drive, Calendar, Jira, GitHub, Notion, and MCP tools. |
| [LLM Providers](/admin/llm-providers) | Provider keys, default models, embeddings, vision, and fallback behavior. |
| [Soul and Identity](/admin/soul-and-identity) | Organization and user-level AI personality and working-context docs. |
| [SSO](/admin/sso) | SAML or OIDC configuration where available. |
| [Skill Governance](/admin/skill-governance) | Review and trust reusable skills before broad rollout. |
| [Governance](/admin/governance) | Monitor, warn, or block policy rules. |
| [Compliance](/admin/compliance) | Sensitive-data detection and scrubbing packs. |
| [Audit Logs](/admin/audit-logs) | Security-sensitive event review. |
| [Analytics](/admin/analytics) | Usage, adoption, and routine activity. |
| [Cognitive Profiles](/admin/cognitive-profiles) | Digital co-worker settings and user opt-out controls. |
| [Decision Graph](/admin/decision-graph) | Decision capture, review, patterns, principles, and sensitivity controls. |

## First Admin Checklist

1. Confirm the organization name and first admin account.
2. Invite the initial users.
3. Create teams that map to how context should be shared.
4. Configure at least one LLM provider.
5. Set the org-level SOUL.md baseline.
6. Connect the first integrations.
7. Review sharing and task behavior with a small pilot group.
8. Enable governance and compliance controls that match your risk profile.
9. Confirm audit and analytics access.
10. Decide whether cognitive profiles should remain off or be enabled.

## Edition Differences

| Topic | Hearth Cloud | Self-hosted Hearth |
|---|---|---|
| Workspace admin | Configure in the app | Configure in the app |
| Infrastructure admin | Managed by Hearth | Operated by your team |
| Secrets and environment | Cloud platform responsibility plus workspace-level credentials | Your `.env`, Kubernetes secrets, and secret manager |
| Backups and upgrades | Managed service responsibility | Your responsibility |
| Custom code | Not intended for per-customer forks | Fully customizable |

See [Cloud vs Self-Hosted](/getting-started/comparison).
