# Service Directory

All backend services live in `apps/api/src/services/`. Each service is a module that encapsulates a specific domain. Services communicate with the database through Prisma and with each other through direct imports.

Jobs and schedulers live in `apps/api/src/jobs/`.

---

## Core Services

| Service | File | Description |
|---|---|---|
| auth-service | `auth-service.ts` | Authentication, session management, password hashing, and OAuth callback handling. |
| chat-service | `chat-service.ts` | Chat session CRUD, message persistence, agent orchestration, and session access control (owner/collaborator/org-visible). |
| task-service | `task-service.ts` | Task CRUD, status lifecycle management, and priority ordering. |
| task-planner | `task-planner.ts` | AI-powered task decomposition -- breaks complex tasks into sub-tasks with execution plans. |
| task-executor | `task-executor.ts` | Task execution engine that drives agent tool use through the planning and execution phases. |
| task-detector | `task-detector.ts` | LLM-based task detection from integration events (emails, Slack messages, calendar items). |
| memory-service | `memory-service.ts` | Memory CRUD with layer-based permissions, hybrid search (vector + full-text), and expiration management. |
| embedding-service | `embedding-service.ts` | Vector embedding generation using configurable providers. Supports flexible embedding dimensions. |
| skill-service | `skill-service.ts` | Skill CRUD, per-user installation/uninstallation, scope management, and usage tracking. |
| skill-loader | `skill-loader.ts` | Loads skill definitions from the filesystem (`agent-skills/skills/`) and syncs them to the database. |
| skill-validator | `skill-validator.ts` | Schema validation for SKILL.md files -- validates frontmatter, required fields, and capability declarations. |
| routine-service | `routine-service.ts` | Routine CRUD, scheduling configuration, execution orchestration, and delivery dispatch. |
| identity-service | `identity-service.ts` | SOUL.md and IDENTITY.md management -- the identity chain that defines the agent's personality per org and per user. |

---

## Integration Services

| Service | File | Description |
|---|---|---|
| integration-service | `integration-service.ts` | Integration connection management, credential storage (AES-256-GCM encrypted), status tracking, and health checks. |
| slack-service | `slack-service.ts` | Slack-specific API interactions: sending messages, reading channels, managing webhooks, and approval request delivery. |
| webhook-service | `webhook-service.ts` | Webhook endpoint management -- creates, lists, and manages inbound webhook URLs with per-endpoint secrets. |
| webhook-verifier | `webhook-verifier.ts` | Signature verification for incoming webhooks. Supports provider-specific verification (GitHub HMAC-SHA256, Slack signing secret, etc.). |
| event-normalizer | `event-normalizer.ts` | Normalizes raw webhook payloads from different providers into a common `NormalizedEvent` schema with provider, event type, actor, resource, and payload. |
| event-dedup | `event-dedup.ts` | Deduplication of inbound work intake events using content fingerprinting to prevent duplicate task creation. |
| trigger-matcher | `trigger-matcher.ts` | Matches incoming normalized webhook events against routine trigger configurations (event type filters, JSON path conditions, parameter extraction). |

---

## Activity and Feed

| Service | File | Description |
|---|---|---|
| activity-feed-service | `activity-feed-service.ts` | Activity feed aggregation with cursor-based pagination, event enrichment, and filtering by event type. |
| activity-reaction-service | `activity-reaction-service.ts` | Emoji reactions on activity feed events -- add, remove, and list reactions per event. |
| proactive-signal-service | `proactive-signal-service.ts` | AI-generated proactive signal detection -- identifies noteworthy patterns in activity data and surfaces them to users. |

---

## Routine Advanced

| Service | File | Description |
|---|---|---|
| chain-service | `chain-service.ts` | Routine chaining with directed graph management and cycle detection. Supports conditional chaining (on_success, on_failure, always) with parameter mapping between routines. |
| pipeline-service | `pipeline-service.ts` | Pipeline execution orchestration -- manages multi-routine pipelines triggered by chains, tracks aggregate status across all runs. |
| routine-analytics-service | `routine-analytics-service.ts` | Execution analytics for routines -- success rates, average duration, token consumption, and failure trends. |
| routine-context-service | `routine-context-service.ts` | Context assembly for routine execution -- loads run-to-run state, previous run outputs, and state configuration for injection into the agent's system prompt. |
| routine-health-service | `routine-health-service.ts` | Health monitoring for routines -- tracks consecutive failures, missed schedules, and cost anomalies against configurable alert thresholds. |
| routine-parameter-service | `routine-parameter-service.ts` | Parameter extraction and validation for parameterized routines -- resolves parameter values from trigger events, manual input, or chain mappings. |
| delivery-service | `delivery-service.ts` | Generic delivery to output channels (in-app notification, Slack, email) based on routine delivery configuration. |
| delivery-rule-engine | `delivery-rule-engine.ts` | Configurable delivery rules that route routine output based on delivery tags, content patterns, and severity thresholds. |

---

## Governance and Compliance

| Service | File | Description |
|---|---|---|
| governance-service | `governance-service.ts` | Policy evaluation engine -- checks messages and actions against configured policies (keyword blocklists, regex patterns, custom rules). Supports monitor, warn, and block enforcement levels. |
| approval-service | `approval-service.ts` | Approval request lifecycle management -- creates approval requests at routine checkpoints, tracks reviewer decisions, handles timeouts with auto-approve/reject. |
| audit-service | `audit-service.ts` | Comprehensive audit trail logging -- records all significant actions (session creation, task changes, routine runs, policy violations) with actor, entity, and detail metadata. |
| sso-service | `sso-service.ts` | SAML/OIDC SSO handling -- processes SSO callbacks, maps external identities to Hearth users, and manages SSO configuration per org. |

---

## Intelligence

| Service | File | Description |
|---|---|---|
| cognitive-profile-service | `cognitive-profile-service.ts` | Cognitive profile management -- extracts thought patterns from chat sessions, deduplicates via embedding similarity, rebuilds profile summaries daily, and provides semantic search for `@mention` queries. Gated behind org + user settings. |
| sherpa-service | `sherpa-service.ts` | AI recommendation engine -- suggests next actions, relevant memories, and useful skills based on the user's current context. |
| skill-proposal-service | `skill-proposal-service.ts` | Agent-proposed skill creation -- after task completion, evaluates whether the approach should be generalized into a reusable skill. |
| synthesis-service | `synthesis-service.ts` | Memory synthesis pipeline -- consolidates session-scoped memories into permanent org/team/user memories, merging duplicates and resolving conflicts. |
| meeting-prep-service | `meeting-prep-service.ts` | Proactive meeting preparation -- pulls relevant context from memory, tasks, and integrations before upcoming calendar events. |
| intake-deduplicator | `intake-deduplicator.ts` | Task deduplication for work intake -- uses semantic similarity to prevent creating duplicate tasks from the same underlying work item across different integration sources. |

---

## Utilities

| Service | File | Description |
|---|---|---|
| web-service | `web-service.ts` | Web browsing capability -- search (Brave/Google) and fetch (URL to readable text extraction) used by the agent's `web_search` and `web_fetch` tools. |
| artifact-service | `artifact-service.ts` | Artifact CRUD and versioning -- creates, updates, reads, and deletes artifacts with automatic version history tracking. |

---

## Jobs and Schedulers

Jobs run on a schedule using BullMQ with Redis as the backing store. Each job is a standalone module in `apps/api/src/jobs/`.

| Job | File | Description |
|---|---|---|
| routine-scheduler | `routine-scheduler.ts` | Cron-based routine execution -- evaluates all enabled routines on each tick and enqueues those whose cron expressions match. |
| routine-health-checker | `routine-health-checker.ts` | Periodic health monitoring -- checks routine health alerts (consecutive failures, missed schedules, high cost) and fires notifications when thresholds are breached. |
| work-intake-scheduler | `work-intake-scheduler.ts` | Continuous integration monitoring -- polls connected integrations for new work items (emails, Slack messages, issues) and feeds them through the task detection pipeline. |
| meeting-prep-scheduler | `meeting-prep-scheduler.ts` | Calendar event preparation -- scans upcoming calendar events and triggers the meeting-prep-service to assemble relevant context proactively. |
| synthesis-scheduler | `synthesis-scheduler.ts` | 24-hour memory synthesis -- runs the synthesis pipeline daily to consolidate session-scoped memories into permanent entries. |
| activity-digest-scheduler | `activity-digest-scheduler.ts` | Periodic activity summaries -- generates digest notifications for org activity at configurable intervals. |
| skill-proposal-job | `skill-proposal-job.ts` | Post-task skill evaluation -- after tasks complete, evaluates whether the approach should be proposed as a reusable skill. |
| cognitive-extraction-scheduler | `cognitive-extraction-scheduler.ts` | Post-session cognitive extraction -- extracts thought patterns from qualifying chat sessions asynchronously. Also runs daily profile rebuild at 3am UTC. |
