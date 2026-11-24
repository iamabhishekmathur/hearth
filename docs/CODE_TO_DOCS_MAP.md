# Code to Documentation Mapping

This file maps source code areas to their corresponding documentation pages. When modifying source files, update the mapped doc page to keep the docs in sync.

## Product Guide

| Source | Doc Page |
|---|---|
| `apps/web/src/pages/chat.tsx`, `apps/web/src/components/chat/*`, `apps/web/src/hooks/use-chat.ts` | `docs/guide/chat.md` |
| `apps/web/src/hooks/use-artifacts.ts`, `apps/web/src/components/chat/artifact-*`, `apps/api/src/routes/artifacts.ts` | `docs/guide/artifacts.md` |
| `apps/web/src/components/chat/share-dialog.tsx`, `apps/api/src/routes/sharing.ts` | `docs/guide/chat.md` |
| `apps/web/src/components/notifications/*`, `apps/api/src/services/notification-service.ts`, `apps/api/src/routes/notifications.ts` | `docs/guide/activity.md` |
| `apps/web/src/components/chat/task-composer.tsx`, `apps/web/src/components/chat/task-chip.tsx`, `apps/web/src/components/chat/task-suggestion-card.tsx`, `apps/web/src/components/chat/task-toast.tsx`, `apps/api/src/routes/task-suggestions.ts` | `docs/guide/tasks.md` |
| `apps/web/src/pages/tasks.tsx`, `apps/web/src/components/tasks/*`, `apps/web/src/hooks/use-tasks.ts` | `docs/guide/tasks.md` |
| `apps/api/src/routes/tasks.ts`, `apps/api/src/services/task-service.ts`, `apps/api/src/services/task-planner.ts`, `apps/api/src/services/task-executor.ts` | `docs/guide/tasks.md` |
| `apps/api/src/services/task-detector.ts`, `apps/api/src/routes/intake.ts` | `docs/guide/tasks.md` |
| `apps/api/src/services/approval-service.ts`, `apps/api/src/routes/approvals.ts` | `docs/guide/tasks.md` |
| `apps/api/src/services/task-context-service.ts`, `apps/api/src/services/task-context-extractor.ts` | `docs/guide/tasks.md` |
| `apps/web/src/pages/routines.tsx`, `apps/web/src/components/routines/*`, `apps/api/src/routes/routines.ts` | `docs/guide/routines.md` |
| `apps/api/src/services/chain-service.ts`, `apps/web/src/components/routines/chain-editor.tsx` | `docs/guide/routines.md` |
| `apps/web/src/components/routines/routine-templates.tsx` | `docs/guide/routines.md` |
| `apps/web/src/pages/memory.tsx`, `apps/api/src/services/memory-service.ts`, `apps/api/src/routes/memory.ts` | `docs/guide/memory.md` |
| `apps/api/src/services/synthesis-service.ts` | `docs/guide/memory.md` |
| `apps/web/src/pages/skills.tsx`, `apps/web/src/components/skills/*`, `apps/api/src/routes/skills.ts` | `docs/guide/skills.md` |
| `apps/web/src/pages/activity.tsx`, `apps/web/src/components/activity/*`, `apps/api/src/routes/activity.ts` | `docs/guide/activity.md` |
| `apps/api/src/services/proactive-signal-service.ts`, `apps/api/src/services/meeting-prep-service.ts` | `docs/guide/activity.md` |
| `apps/web/src/components/settings/chatgpt-plan-settings.tsx`, `apps/web/src/components/chat/chatgpt-plan-indicator.tsx`, `apps/web/src/hooks/use-chatgpt-plan.ts` | `docs/guide/chatgpt-plan.md` |
| `apps/web/src/pages/decisions.tsx`, `apps/web/src/components/decisions/*`, `apps/web/src/hooks/use-decisions.ts` | `docs/guide/decisions.md` |
| `apps/web/src/pages/review.tsx`, `apps/web/src/components/knowledge/*`, `apps/web/src/hooks/use-knowledge.ts` (route `#/review`) | `docs/guide/review.md` |
| `apps/api/src/routes/decisions.ts`, `apps/api/src/routes/meetings.ts`, `apps/api/src/services/decision-*`, `apps/api/src/jobs/decision-*` | `docs/guide/decisions.md`, `docs/admin/cognitive-profiles.md` when admin settings change |

## Admin Guide

| Source | Doc Page |
|---|---|
| `apps/web/src/pages/settings.tsx` | `docs/admin/index.md` and the affected admin page |
| `apps/api/src/routes/admin/users.ts`, `apps/api/src/routes/admin/teams.ts`, `apps/web/src/components/admin/user-management.tsx`, `apps/web/src/components/admin/team-management.tsx` | `docs/admin/users-and-teams.md` |
| `apps/api/src/mcp/connectors/*`, `apps/api/src/mcp/connection-manager.ts`, `apps/api/src/routes/admin/integrations.ts`, `apps/web/src/components/admin/integration-health.tsx`, `apps/web/src/components/integrations/connect-tools.tsx` | `docs/admin/integrations.md`, `docs/cloud/integrations.md` |
| `apps/api/src/services/invitation-service.ts`, `apps/web/src/components/invitations/*`, `apps/web/src/pages/accept-invite.tsx` | `docs/admin/users-and-teams.md` |
| `apps/api/src/routes/admin/llm-config.ts`, `apps/api/src/llm/*`, `apps/web/src/components/admin/llm-config.tsx` | `docs/admin/llm-providers.md`, `docs/self-hosting/configuration.md` when env vars change |
| `apps/web/src/pages/settings.tsx`, `apps/api/src/routes/identity.ts` | `docs/admin/soul-and-identity.md` |
| `apps/api/src/services/sso-service.ts`, `apps/api/src/routes/admin/sso.ts`, `POST /auth/sso/callback` in `apps/api/src/routes/auth.ts` | `docs/admin/sso.md` |
| `apps/web/src/components/admin/skill-governance.tsx`, skill review behavior in `apps/api/src/routes/skills.ts` | `docs/admin/skill-governance.md` |
| `apps/api/src/services/governance-service.ts`, `apps/api/src/routes/admin/governance.ts`, `apps/web/src/components/admin/governance-config.tsx` | `docs/admin/governance.md` |
| `apps/api/src/routes/admin/compliance.ts`, `apps/api/src/compliance/*`, `apps/web/src/components/admin/compliance-config.tsx` | `docs/admin/compliance.md` |
| `apps/api/src/services/audit-service.ts`, `apps/api/src/routes/admin/audit-logs.ts` | `docs/admin/audit-logs.md` |
| `apps/api/src/routes/admin/analytics.ts`, `apps/web/src/components/admin/usage-analytics.tsx` | `docs/admin/analytics.md` |
| `apps/api/src/services/cognitive-profile-service.ts`, `apps/api/src/routes/admin/cognitive.ts`, `apps/api/src/jobs/cognitive-extraction-scheduler.ts`, `apps/web/src/components/admin/cognitive-config.tsx` | `docs/admin/cognitive-profiles.md` |
| `apps/api/src/services/decision-service.ts`, `apps/api/src/services/decision-pattern-service.ts`, `apps/api/src/services/org-principle-service.ts`, `apps/api/src/jobs/decision-*` | `docs/admin/decision-graph.md`, `docs/guide/decisions.md` |

## Cloud

| Source | Doc Page |
|---|---|
| Cloud onboarding, workspace setup, or managed-service admin behavior | `docs/getting-started/cloud.md`, `docs/cloud/workspace-setup.md` |
| Cloud security posture, tenant isolation, retention, backups, subprocessors, data export, or deletion | `docs/cloud/security-and-data.md` |
| Cloud integration setup or managed-connector behavior | `docs/cloud/integrations.md` |
| Billing, limits, plans, trials, support levels, or commercial policy | `docs/cloud/limits-and-billing.md`, `docs/cloud/support.md` |

## Self-Hosting

| Source | Doc Page |
|---|---|
| `docker-compose.yml` | `docs/self-hosting/docker.md` |
| `deploy/helm/hearth/*` | `docs/self-hosting/kubernetes.md` |
| `apps/api/src/config.ts`, `.env.example` | `docs/self-hosting/configuration.md` |
| Secrets, credential encryption, `ENCRYPTION_KEY`, `SESSION_SECRET` | `docs/self-hosting/secrets.md` |
| Migrations, backups, restore, upgrade commands | `docs/self-hosting/backups-and-upgrades.md` |
| Health checks, logs, metrics, queues, worker operations | `docs/self-hosting/monitoring.md` |
| Common deployment failures and operational debugging | `docs/self-hosting/troubleshooting.md` |
| `apps/web/src/pages/setup-wizard.tsx`, `apps/api/src/routes/admin/setup.ts` | `docs/getting-started/self-hosted.md`, `docs/getting-started/cloud.md` when cloud setup behavior changes |

## Developers

| Source | Doc Page |
|---|---|
| `apps/api/src/routes/chat.ts`, `apps/api/src/services/command-registry.ts`, `apps/api/src/services/command-service.ts` | `docs/developers/api/chat.md` |
| `apps/api/src/routes/chatgpt-plan.ts`, `apps/api/src/services/chatgpt-plan-service.ts`, `apps/api/src/llm/chatgpt-plan-provider.ts` | `docs/developers/api/chatgpt-plan.md`, `docs/guide/chatgpt-plan.md`, `docs/self-hosting/configuration.md` when env vars change |
| `apps/api/src/routes/tasks.ts`, `apps/api/src/services/task-context-service.ts`, `apps/api/src/services/task-context-extractor.ts` | `docs/developers/api/tasks.md` |
| `apps/api/src/routes/memory.ts` | `docs/developers/api/memory.md` |
| `apps/api/src/services/knowledge-signals.ts`, `apps/api/src/jobs/knowledge-signal-cleanup-scheduler.ts`, `apps/api/src/scripts/sample-knowledge-signals.ts` | `docs/developers/architecture/database.md`, `docs/guide/memory.md`, `docs/developers/api/chat.md` |
| `apps/api/src/routes/knowledge.ts`, `apps/api/src/services/knowledge-proposals.ts`, `apps/api/src/services/knowledge-curator.ts`, `apps/api/src/jobs/knowledge-curator-scheduler.ts`, `apps/api/src/scripts/curator-eval.ts`, `apps/api/src/scripts/knowledge-loop-flag.ts` | `docs/developers/api/knowledge.md`, `docs/developers/architecture/database.md`, `docs/guide/review.md`, `docs/admin/index.md` |
| `apps/api/src/services/knowledge-versions.ts`, `apps/api/src/services/knowledge-owner.ts` | `docs/developers/api/memory.md`, `docs/developers/api/routines.md`, `docs/developers/architecture/database.md` |
| `apps/api/src/routes/skills.ts` | `docs/developers/api/skills.md` |
| `apps/api/src/routes/routines.ts`, `apps/api/src/routes/chains.ts` | `docs/developers/api/routines.md` |
| `apps/api/src/routes/activity.ts` | `docs/developers/api/activity.md` |
| `apps/api/src/routes/artifacts.ts` | `docs/developers/api/artifacts.md` |
| `apps/api/src/routes/admin/*` | `docs/developers/api/admin.md` |
| `apps/api/src/routes/webhooks/*`, `apps/api/src/routes/uploads.ts` | `docs/developers/api/webhooks.md` |
| `apps/api/src/routes/decisions.ts`, `apps/api/src/routes/meetings.ts` | `docs/developers/api/decisions.md` |
| `apps/api/src/ws/socket-manager.ts` | `docs/developers/websocket-events.md` |
| `apps/api/src/agent/*` | `docs/developers/architecture/agent.md` |
| `apps/api/prisma/schema.prisma` | `docs/developers/architecture/database.md` |
| `apps/api/src/lib/tenant-context.ts`, `apps/api/src/lib/prisma-tenant-extension.ts`, `apps/api/src/lib/job-context.ts` | `docs/developers/architecture/database.md` (Tenancy and Row-Level Security) |
| `apps/api/src/services/*` | `docs/developers/architecture/services.md` |
| `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/analytics-events.ts`, `apps/api/src/lib/analytics.ts` | `docs/growth/EVENTS.md` |
