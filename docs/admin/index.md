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

## Knowledge Loop

The knowledge loop turns quiet gap signals (searches that found nothing, corrections, thumbs-downs, failed routine runs) into proposed fixes that owners review in the [Review Inbox](/guide/review). It is **off by default** and is turned on per organization with the `knowledgeLoop` feature flag.

There is no settings screen for it yet. An operator turns it on or off with:

```bash
pnpm --filter @hearth/api knowledge:flag -- --org <orgId> --on
pnpm --filter @hearth/api knowledge:flag -- --org <orgId> --off
```

When it is on:

- A curator runs every night at 04:00 UTC (worker queue `knowledge-curator`). It calls the model only when there are new signals, at most once per memory entry or routine.
- The **Review** item appears in the sidebar, and owners get at most five new cards a day.
- Admins can run the curator at once with `POST /api/v1/knowledge/curator/run`.
- Every approve, edit or reject writes an audit log row (`knowledge_proposal_approved`, `knowledge_proposal_edited`, `knowledge_proposal_rejected`).
- Routines get version history with restore, a visible owner, dry runs and test cases. Saving a change that breaks a test case writes `knowledge_tests_override`. See [Routines](/guide/routines#versions-dry-runs-and-tests).

When it is off, the curator skips the organization and every `/api/v1/knowledge` route answers `404`. Turning it off does not delete open cards; they come back if it is turned on again. See [Knowledge API](/developers/api/knowledge).

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
