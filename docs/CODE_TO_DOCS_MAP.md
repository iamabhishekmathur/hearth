# Code to Documentation Mapping

This file maps source code directories to their corresponding documentation pages.
When modifying source files, update the mapped doc page to keep documentation in sync.

## User Guide

| Source | Doc Page |
|--------|----------|
| `apps/web/src/pages/chat.tsx`, `apps/web/src/components/chat/*`, `apps/web/src/hooks/use-chat.ts` | `docs/guide/chat.md` |
| `apps/web/src/hooks/use-artifacts.ts`, `apps/web/src/components/chat/artifact-*` | `docs/guide/chat-artifacts.md` |
| `apps/web/src/components/chat/share-dialog.tsx`, `apps/api/src/routes/sharing.ts` | `docs/guide/chat-sharing.md` |
| `apps/web/src/pages/workspace.tsx`, `apps/web/src/components/workspace/*` | `docs/guide/workspace.md` |
| `apps/api/src/jobs/work-intake-scheduler.ts`, `apps/api/src/services/task-detector.ts` | `docs/guide/work-intake.md` |
| `apps/api/src/services/approval-service.ts`, `apps/api/src/routes/approvals.ts` (if exists) | `docs/guide/approvals.md` |
| `apps/api/src/services/task-executor.ts`, `apps/api/src/services/task-planner.ts` | `docs/guide/task-execution.md` |
| `apps/web/src/pages/routines.tsx`, `apps/web/src/components/routines/*` | `docs/guide/routines.md` |
| `apps/api/src/services/chain-service.ts`, `apps/web/src/components/routines/chain-editor.tsx` | `docs/guide/routine-chains.md` |
| `apps/web/src/components/routines/routine-templates.tsx` | `docs/guide/routine-templates.md` |
| `apps/web/src/pages/memory.tsx`, `apps/api/src/services/memory-service.ts` | `docs/guide/memory.md` |
| `apps/api/src/services/synthesis-service.ts`, `apps/api/src/jobs/synthesis-scheduler.ts` | `docs/guide/memory-synthesis.md` |
| `apps/web/src/pages/skills.tsx`, `apps/web/src/components/skills/*` | `docs/guide/skills.md` |
| `apps/web/src/pages/activity.tsx`, `apps/web/src/components/activity/*` | `docs/guide/activity.md` |
| `apps/api/src/services/proactive-signal-service.ts`, `apps/api/src/services/meeting-prep-service.ts` | `docs/guide/proactive-signals.md` |
| `apps/web/src/pages/decisions.tsx`, `apps/web/src/components/decisions/*`, `apps/web/src/hooks/use-decisions.ts` | `docs/guide/index.md` (Decision Graph section) |

## Platform

| Source | Doc Page |
|--------|----------|
| `apps/api/src/routes/admin/users.ts`, `apps/api/src/routes/admin/teams.ts` | `docs/platform/users-and-teams.md` |
| `apps/api/src/mcp/connectors/*`, `apps/api/src/routes/admin/integrations.ts` | `docs/platform/integrations.md` |
| `apps/api/src/routes/admin/llm-config.ts`, `apps/api/src/llm/*` | `docs/platform/llm-config.md` |
| `apps/web/src/pages/settings.tsx`, `apps/api/src/routes/identity.ts` | `docs/platform/soul-and-identity.md` |
| `apps/api/src/services/governance-service.ts`, `apps/api/src/routes/admin/governance.ts` | `docs/platform/governance.md` |
| `apps/api/src/routes/admin/compliance.ts` | `docs/platform/compliance.md` |
| `apps/api/src/routes/admin/analytics.ts` | `docs/platform/analytics.md` |
| `apps/api/src/services/audit-service.ts`, `apps/api/src/routes/admin/audit-logs.ts` | `docs/platform/audit-logs.md` |
| `apps/api/src/services/sso-service.ts`, `apps/api/src/routes/admin/sso.ts` | `docs/platform/sso.md` |
| `apps/api/src/services/cognitive-profile-service.ts`, `apps/api/src/routes/admin/cognitive.ts`, `apps/api/src/jobs/cognitive-extraction-scheduler.ts` | `docs/platform/cognitive-profiles.md` |
| `apps/api/src/services/decision-service.ts`, `apps/api/src/services/decision-pattern-service.ts`, `apps/api/src/services/org-principle-service.ts`, `apps/api/src/jobs/decision-*` | `docs/platform/decision-graph.md` |

## Developers

| Source | Doc Page |
|--------|----------|
| `apps/api/src/routes/chat.ts` | `docs/developers/api/chat.md` |
| `apps/api/src/routes/tasks.ts`, `apps/api/src/services/task-context-service.ts`, `apps/api/src/services/task-context-extractor.ts` | `docs/developers/api/tasks.md` |
| `apps/api/src/routes/memory.ts` | `docs/developers/api/memory.md` |
| `apps/api/src/routes/skills.ts` | `docs/developers/api/skills.md` |
| `apps/api/src/routes/routines.ts` | `docs/developers/api/routines.md` |
| `apps/api/src/routes/activity.ts` | `docs/developers/api/activity.md` |
| `apps/api/src/routes/artifacts.ts` | `docs/developers/api/artifacts.md` |
| `apps/api/src/routes/admin/*` | `docs/developers/api/admin.md` |
| `apps/api/src/routes/webhooks/*`, `apps/api/src/routes/uploads.ts` | `docs/developers/api/webhooks.md` |
| `apps/api/src/routes/decisions.ts`, `apps/api/src/routes/meetings.ts` | `docs/developers/api/decisions.md` |
| `apps/api/src/ws/socket-manager.ts` | `docs/developers/websocket-events.md` |
| `apps/api/src/agent/*` | `docs/developers/architecture/agent.md` |
| `apps/api/prisma/schema.prisma` | `docs/developers/architecture/database.md` |
| `apps/api/src/services/*` | `docs/developers/architecture/services.md` |

## Self-Hosting

| Source | Doc Page |
|--------|----------|
| `docker-compose.yml` | `docs/self-hosting/docker.md` |
| `deploy/helm/hearth/*` | `docs/self-hosting/kubernetes.md` |
| `apps/api/src/config.ts`, `.env.example` | `docs/getting-started/configuration.md` |
| `apps/web/src/pages/setup-wizard.tsx` | `docs/getting-started/first-run.md` |
