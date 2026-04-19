# Database

Hearth uses PostgreSQL as its single database for relational data, vector embeddings (via pgvector), and full-text search. All database access goes through Prisma ORM.

## Prisma Schema

The schema is defined in `apps/api/prisma/schema.prisma`. Prisma generates TypeScript types and a query client from this schema.

```bash
# View the schema
cat apps/api/prisma/schema.prisma

# Open Prisma Studio (visual database browser)
pnpm db:studio

# Create a new migration after schema changes
pnpm db:migrate
```

## Key Models

### User and Organization

```
Org (organization)
  ├── Team[]
  │     └── User[] (members)
  ├── Settings (JSONB: LLM providers, enabled capabilities)
  └── SSOConfig (JSONB: SAML/OIDC configuration)

User
  ├── email, name, role (admin | team_lead | member | viewer)
  ├── auth_provider (email | google | github | saml)
  ├── password_hash (null for OAuth/SSO users)
  └── preferences (JSONB)
```

Users belong to a team within an organization. The `role` field controls access: `admin` users can manage the org, `team_lead` users can manage their team, `member` users have standard access, and `viewer` users have read-only access.

### Chat Sessions

```
ChatSession
  ├── user_id (owner)
  ├── title, status (active | archived)
  ├── visibility (private | org)
  ├── SessionCollaborator[] (viewer | contributor roles)
  ├── SessionShare[] (shareable links with token, type, expiry)
  ├── ChatMessage[]
  │     ├── role (user | assistant | system | tool)
  │     ├── content
  │     ├── metadata (JSONB: tool calls, model, token count)
  │     ├── created_by (foreign key to User, nullable)
  │     └── ChatAttachment[]
  └── Artifact[]
```

Messages have a full-text search index on `content` using PostgreSQL's `tsvector`. The `metadata` JSONB field stores model-specific information like which LLM was used, token counts, and tool call details.

Sessions support multiplayer collaboration through `SessionCollaborator` (direct user access with role) and `SessionShare` (link-based sharing with configurable types: full, results_only, template).

### Chat Attachments

```
ChatAttachment
  ├── id
  ├── message_id (nullable, foreign key to ChatMessage)
  ├── filename
  ├── mime_type
  ├── size_bytes
  ├── storage_path
  ├── width, height (nullable, for images)
  └── created_at
```

Attachments store metadata for files uploaded alongside chat messages. The actual file content lives on disk at `storage_path`. The `message_id` is nullable to support uploading files before the message is sent. Image attachments include optional `width` and `height` dimensions.

### Artifacts

```
Artifact
  ├── id
  ├── session_id (foreign key to ChatSession)
  ├── type: code | document | diagram | table | html | image
  ├── title
  ├── content (full artifact content)
  ├── language (nullable, for code artifacts — e.g., "typescript", "python")
  ├── version (integer, incremented on each update)
  ├── created_by (foreign key to User)
  ├── parent_message_id (nullable, links to originating message)
  ├── created_at, updated_at
  └── ArtifactVersion[]

ArtifactVersion
  ├── id
  ├── artifact_id (foreign key to Artifact)
  ├── version (integer)
  ├── title
  ├── content (snapshot of content at this version)
  ├── edited_by (foreign key to User)
  └── created_at
```

Artifacts are persistent, versioned content objects created by the agent during chat sessions. Each update increments the `version` counter on the Artifact and creates a new `ArtifactVersion` record with the previous content, enabling full version history.

Artifacts are scoped to a session via `session_id` and optionally linked to the message that created them via `parent_message_id`. The `type` enum determines how the frontend renders the artifact (syntax-highlighted code, rendered markdown, Mermaid diagram, etc.).

Indexes: `session_id` and `created_by` for efficient lookups.

### Tasks (Kanban)

```
Task
  ├── user_id (owner)
  ├── title, description
  ├── status: auto_detected → backlog → planning → executing → review → done | failed | archived
  ├── source: email | slack | meeting | manual | agent_proposed | sub_agent
  ├── source_ref (JSONB: reference to original email/slack/meeting)
  ├── context (JSONB: integrations, memory, documents)
  ├── parent_task_id (for sub-tasks)
  ├── agent_output (JSONB: result produced by agent)
  ├── priority (0-3, where 3 is highest)
  ├── TaskComment[]
  ├── TaskExecutionStep[]
  │     ├── step_number, description, status, phase (planning | execution)
  │     ├── tool_used (capability or MCP tool name)
  │     ├── input/output (JSONB)
  │     └── duration_ms
  ├── TaskReview[]
  │     ├── reviewer_id (foreign key to User)
  │     ├── decision (approved | changes_requested)
  │     └── feedback
  └── TaskContextItem[]
        ├── type: note | link | file | image | text_block | mcp_reference
        ├── raw_value (URL for links, filename for files, text for notes)
        ├── mime_type, size_bytes, storage_path (for file/image uploads)
        ├── extracted_text, extracted_title (populated by extraction pipeline)
        ├── extraction_status: pending | processing | completed | failed | skipped
        ├── mcp_integration_id, mcp_resource_type, mcp_resource_id (for MCP references)
        ├── vision_analysis (opt-in image description)
        ├── embedding (vector for semantic search)
        └── sort_order, created_by
```

Tasks flow through a kanban pipeline. The `source` field tracks where the task originated — work intake can auto-detect tasks from email, Slack, and calendar. Sub-tasks reference their parent via `parent_task_id`.

Task execution steps record the agent's tool usage during planning and execution phases, including timing data for observability.

Task context items provide rich context (links, PDFs, files, images, text blocks, MCP data) that is extracted asynchronously and serialized into agent prompts with token budgeting. The legacy `context` JSON field is preserved for backward compatibility.

### Memory

```
MemoryEntry
  ├── org_id, team_id?, user_id?  (scoping)
  ├── layer: org | team | user | session
  ├── content (text)
  ├── source: manual | synthesis | session | integration
  ├── source_ref (JSONB: optional reference to origin)
  ├── embedding: vector  (pgvector, flexible dimension)
  └── expires_at? (null = permanent)
```

Memory entries are scoped by layer:

| Layer | Scope | Example |
|---|---|---|
| `org` | Entire organization | "Our fiscal year starts in April" |
| `team` | Single team | "The design team uses Figma for all mockups" |
| `user` | Individual user | "Abhishek prefers bullet-point summaries" |
| `session` | Single chat session | Temporary context (expired by synthesis) |

#### Flexible Embedding Dimensions

The `embedding` column uses Prisma's `Unsupported("vector")` type, which maps to pgvector's `vector` type without a fixed dimension. This allows the embedding dimension to vary based on the configured embedding provider:

- OpenAI `text-embedding-3-small`: 1536 dimensions
- OpenAI `text-embedding-3-large`: 3072 dimensions
- Ollama models: varies by model (e.g., 768, 1024, 4096)

The embedding service generates vectors at whatever dimension the configured provider produces. The IVFFlat index is created without a hardcoded dimension, allowing the system to work with any embedding model.

Semantic search uses pgvector's cosine similarity:

```sql
SELECT * FROM memory_entries
ORDER BY embedding <=> $query_embedding
LIMIT 10;
```

Index: composite index on `(org_id, team_id, user_id, layer)` for scoped queries.

### Agent Identity

```
AgentIdentity
  ├── org_id, user_id?
  ├── file_type: soul | identity
  ├── content (markdown)
  └── source: manual | template | auto_generated
```

- **SOUL.md** — Defines the agent's personality, communication style, and behavioral guidelines. Can be set at org level (default for all users) or per user.
- **IDENTITY.md** — The agent's model of the user: their role, preferences, working style, and context. Updated by the learning loop.

### Integrations

```
Integration
  ├── org_id
  ├── provider (slack | gmail | gdrive | jira | notion | github | gcalendar)
  ├── config (JSONB: provider-specific configuration)
  ├── status (active | inactive | error)
  ├── health_checked_at
  ├── enabled
  └── WebhookEndpoint[]
```

Integration credentials (OAuth tokens) are encrypted at rest using AES-256-GCM with the `ENCRYPTION_KEY` environment variable. The token store handles encryption/decryption transparently.

### Skills

```
Skill
  ├── org_id
  ├── name, description
  ├── content (the SKILL.md content)
  ├── author_id (foreign key to User)
  ├── scope: personal | team | org
  ├── team_id (for team-scoped skills)
  ├── git_ref (optional: git reference for version control)
  ├── required_integrations (string array)
  ├── required_capabilities (string array)
  ├── recommended_model
  ├── status: draft | pending_review | published | deprecated
  ├── install_count
  ├── source_task_id (nullable: links to task that inspired the skill)
  └── UserSkill[] (per-user installation tracking)

UserSkill
  ├── user_id, skill_id (composite primary key)
  └── installed_at
```

Skills are loaded from the filesystem (`agent-skills/skills/`) on startup and synced to the database for tracking activation, usage, and agent-proposed improvements. The scope system controls visibility: personal skills are private, team skills are shared within a team, and org skills are available to everyone.

Unique constraint: `(org_id, name)` ensures skill names are unique within an org.

### Routines

```
Routine
  ├── user_id (owner)
  ├── name, description, prompt
  ├── schedule (cron expression, nullable for event-only routines)
  ├── context (JSONB)
  ├── delivery (JSONB: output channel configuration)
  ├── enabled
  ├── last_run_at, last_run_status
  ├── created_via (manual | agent)
  │
  │  ── Run-to-Run State ──
  ├── state (JSONB: persistent key-value store across runs)
  ├── state_config (JSONB: configuration like trackDeltas, maxKeys)
  │
  │  ── Team Scoping ──
  ├── scope: personal | team | org
  ├── team_id (for team-scoped routines)
  ├── org_id (for org-scoped routines)
  │
  │  ── Parameters ──
  ├── parameters (JSONB array: parameter definitions with name, type, default, required)
  │
  │  ── Approval Gates ──
  ├── checkpoints (JSONB array: checkpoint definitions)
  │
  ├── RoutineRun[]
  ├── RoutineTrigger[]
  ├── ApprovalCheckpoint[]
  ├── RoutineChain[] (from/to)
  └── RoutineHealthAlert[]
```

Routines are the automation engine. They combine a prompt (the instruction), a schedule (when to run), and delivery configuration (where to send output). The enhanced routine system adds several capabilities described below.

Index: `(org_id, team_id, scope)` for efficient scoped queries.

#### Routine Runs

```
RoutineRun
  ├── routine_id
  ├── status: success | failed | running | awaiting_approval
  ├── output (JSONB: agent's output)
  ├── error (text, on failure)
  ├── token_count, duration_ms
  ├── started_at, completed_at
  ├── summary (text: agent-generated summary for run-to-run context)
  ├── trigger_id (nullable: which trigger fired this run)
  ├── trigger_event (JSONB: the event that triggered this run)
  ├── parameter_values (JSONB: resolved parameter values for this run)
  ├── triggered_by: schedule | manual | event
  ├── paused_state (JSONB: execution state when paused at an approval checkpoint)
  └── ApprovalRequest[]
```

Each execution of a routine creates a `RoutineRun` record. The `summary` field enables run-to-run context: the agent can reference what happened in previous runs to track deltas and avoid repeating work.

#### Event-Driven Triggers

```
WebhookEndpoint
  ├── org_id
  ├── integration_id (nullable: links to Integration)
  ├── provider (e.g., "github", "slack", "jira")
  ├── url_token (unique: the secret URL path segment)
  ├── secret (for signature verification)
  ├── enabled
  └── RoutineTrigger[]

RoutineTrigger
  ├── routine_id
  ├── webhook_endpoint_id
  ├── event_type (e.g., "push", "pull_request.opened", "issue.created")
  ├── filters (JSONB: JSON path conditions for matching)
  ├── parameter_mapping (JSONB: maps event fields to routine parameters)
  ├── status: active | paused | error
  ├── last_triggered_at
  └── RoutineRun[]
```

Webhook endpoints provide inbound URLs for external services. Each endpoint has a unique `url_token` and a `secret` for verifying request signatures. Routine triggers connect endpoints to routines: when a webhook event arrives, the trigger matcher evaluates the `event_type` and `filters` to decide whether to fire the routine, and the `parameter_mapping` extracts values from the event payload to pass as routine parameters.

#### Approval Gates

```
ApprovalCheckpoint
  ├── routine_id
  ├── name, description
  ├── position (integer: order in the routine)
  ├── approver_policy (JSONB: who can approve — role-based, specific users, etc.)
  ├── timeout_minutes (nullable)
  └── timeout_action: approve | reject (when timeout expires)

ApprovalRequest
  ├── run_id (foreign key to RoutineRun)
  ├── checkpoint_id (foreign key to ApprovalCheckpoint)
  ├── status: pending | approved | rejected | auto_approved | auto_rejected | edited
  ├── agent_output (text: what the agent produced up to this checkpoint)
  ├── edited_output (text: reviewer's modifications, if edited)
  ├── reviewer_id (nullable)
  ├── reviewer_comment
  ├── slack_message_ts (for Slack-based approval flows)
  ├── timeout_at
  └── resolved_at
```

Approval checkpoints pause routine execution at defined points and require human review before continuing. The `ApprovalRequest` tracks the full lifecycle: creation, reviewer assignment, decision (with optional edited output), and timeout handling.

#### Cross-Routine Chaining

```
RoutineChain
  ├── source_routine_id
  ├── target_routine_id
  ├── condition: on_success | on_failure | always
  ├── parameter_mapping (JSONB: maps source output to target parameters)
  └── enabled

PipelineRun
  ├── root_run_id (the RoutineRun that started the chain)
  ├── status: running | completed | failed | partial
  ├── run_ids (string array: all RoutineRun IDs in the pipeline)
  ├── started_at
  └── completed_at
```

Routine chains create directed graphs of routines that execute in sequence. The chain service includes cycle detection to prevent infinite loops. Each chain link specifies a condition (when to fire) and parameter mapping (how to pass data between routines).

`PipelineRun` tracks the aggregate status of a multi-routine execution triggered by a chain.

Unique constraint: `(source_routine_id, target_routine_id)` prevents duplicate chains.

#### Health Monitoring

```
RoutineHealthAlert
  ├── org_id, routine_id
  ├── alert_type: consecutive_failures | missed_schedule | high_cost
  ├── threshold (JSONB: e.g., { count: 3 } for consecutive failures)
  ├── enabled
  └── last_fired_at
```

Health alerts are configurable per-routine, per-org monitoring rules. The routine health checker job evaluates these alerts periodically and fires notifications when thresholds are breached.

### Activity Reactions

```
ActivityReaction
  ├── audit_log_id (foreign key to AuditLog)
  ├── user_id (foreign key to User)
  ├── emoji (string: the reaction emoji)
  └── created_at
```

Activity reactions allow users to react to events in the activity feed with emoji. Reactions are linked to audit log entries. The unique constraint `(audit_log_id, user_id, emoji)` ensures a user can only add each emoji once per event.

### Audit Logs

```
AuditLog
  ├── org_id
  ├── user_id (nullable: system actions have no user)
  ├── action (string: e.g., "session.created", "task.status_changed", "routine.run")
  ├── entity_type (string: e.g., "ChatSession", "Task", "Routine")
  ├── entity_id
  ├── details (JSONB: action-specific metadata)
  ├── created_at
  └── ActivityReaction[]
```

Audit logs record all significant actions across the platform. Indexed by `(org_id, created_at DESC)` for efficient feed queries and `(user_id, created_at DESC)` for per-user history.

### Governance

```
GovernancePolicy
  ├── org_id
  ├── name, description
  ├── category (default: "custom")
  ├── severity: info | warning | critical
  ├── rule_type (string: e.g., "keyword_blocklist", "regex", "custom")
  ├── rule_config (JSONB: rule-specific configuration)
  ├── enforcement: monitor | warn | block
  ├── scope (JSONB: which teams/users/sessions the policy applies to)
  ├── enabled
  ├── created_by (foreign key to User)
  └── GovernanceViolation[]

GovernanceViolation
  ├── org_id, policy_id, user_id, session_id
  ├── message_id (nullable), message_role
  ├── severity: info | warning | critical
  ├── content_snippet (VARCHAR(500): excerpt of violating content)
  ├── match_details (JSONB: what matched and where)
  ├── enforcement: monitor | warn | block
  ├── status: open | acknowledged | dismissed | escalated
  ├── reviewed_by (nullable), review_note, reviewed_at
  └── created_at
```

Governance policies define organizational rules that the agent must follow. Violations are recorded when messages or actions match policy rules. The enforcement level determines whether violations are silently logged (monitor), shown as warnings (warn), or actively prevented (block).

Indexes: `(org_id, enabled)` for policy lookups, `(org_id, created_at DESC)` and `(org_id, severity)` for violation queries, `(user_id, created_at DESC)` for per-user violation history, and `(policy_id)` for policy-specific queries.

### Cognitive Profiles (Digital Co-Worker)

```
CognitiveProfile
  ├── org_id, user_id (unique together)
  ├── profile (JSONB: CognitiveProfileData — communication style, decision style, expertise, values)
  ├── version (integer: incremented on each rebuild)
  ├── enabled (boolean: user opt-in/out, default true)
  ├── created_at, updated_at
  └── Unique: (org_id, user_id)

ThoughtPattern
  ├── org_id, user_id
  ├── pattern (text: "When [situation], this person tends to [behavior]")
  ├── category (string: decision | preference | expertise | reaction | value | process)
  ├── source_session_id (foreign key to ChatSession)
  ├── source_excerpt (text: direct quote or close paraphrase)
  ├── confidence (float: 0.0-1.0)
  ├── observation_count (integer: how many times this pattern has been observed)
  ├── first_observed, last_reinforced
  ├── superseded_by_id (nullable: self-referential for pattern evolution)
  ├── superseded_reason (text: why this pattern was superseded)
  ├── embedding (vector: for semantic dedup and search)
  └── created_at
```

Cognitive profiles model how each user thinks, extracted automatically from chat conversations. The two-model design separates stable traits (CognitiveProfile, rebuilt daily) from individual evidence units (ThoughtPattern, grows over time).

ThoughtPattern dedup uses cosine similarity at 0.85 threshold: matching patterns are reinforced (observation count incremented), contradictory patterns supersede the older one, and new patterns are created. A per-user cap of 500 active patterns evicts lowest-confidence entries.

The `profile` JSONB field in CognitiveProfile stores a structured `CognitiveProfileData` object with communication style, decision style, expertise areas, values, and anti-patterns. This is injected whole into the system prompt (~500 tokens) during `@mention` queries.

Indexes: `(user_id, category)` for category-scoped queries, `(org_id, user_id)` for org-scoped lookups.

The entire feature is gated behind `Org.settings.cognitiveProfiles.enabled` (default false) and `CognitiveProfile.enabled` (default true, user opt-out).

### Context Graph (Decision Intelligence)

Nine tables form the decision intelligence graph, capturing decisions, their relationships, outcomes, patterns, and principles.

#### Decision

The core node — what was decided, why, by whom.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `org_id` | UUID | Organization |
| `team_id` | UUID? | Team scope (null for org-level) |
| `created_by_id` | UUID | User who captured the decision |
| `session_id` | UUID? | Chat session where decision was made |
| `title` | TEXT | Short decision summary |
| `description` | TEXT? | Additional context |
| `reasoning` | TEXT | Why this was decided |
| `alternatives` | JSONB | `[{ label, pros?, cons? }]` |
| `domain` | TEXT? | engineering, product, hiring, etc. |
| `tags` | TEXT[] | Topic tags |
| `scope` | ENUM | `org`, `team`, `personal` |
| `status` | ENUM | `draft`, `active`, `superseded`, `reversed`, `archived` |
| `confidence` | ENUM | `low`, `medium`, `high` |
| `source` | ENUM | `chat`, `task`, `meeting`, `slack`, `email`, `routine`, `manual`, `external` |
| `source_ref` | JSONB? | Reference to origin (session ID, meeting ID, etc.) |
| `sensitivity` | TEXT | `normal`, `restricted`, `confidential` |
| `participants` | TEXT[] | User IDs involved |
| `quality` | FLOAT | Completeness score (0-1) |
| `importance` | FLOAT | Impact score (0-1) |
| `superseded_by_id` | UUID? | Self-referential — newer decision that replaces this one |
| `embedding` | vector? | Semantic search embedding |

**Indexes:** B-tree on `(org_id, domain, created_at DESC)`, `(org_id, team_id, scope)`, `(created_by_id, created_at DESC)`. IVFFlat cosine on embedding. GIN full-text search on `title || description || reasoning`.

#### DecisionContext

Polymorphic edges linking a decision to its informing context (memories, experiences, documents, people).

#### DecisionLink

Typed edges between decisions: `depends_on`, `supersedes`, `related_to`, `informed_by`, `contradicts`. Unique constraint on `(from, to, relationship)`.

#### DecisionOutcome

Feedback loop — records what happened after a decision. Verdict: `positive`, `negative`, `mixed`, `neutral`, `too_early`. Optional impact score (0-1).

#### DecisionPattern

Recurring patterns extracted from decision clusters. Status: `emerging` (2-3 decisions), `established` (4+), `deprecated`. Has its own embedding for semantic search.

#### DecisionPatternLink

Join table linking decisions to their patterns (many-to-many).

#### OrgPrinciple

High-level principles distilled from established patterns. Each has a `guideline` (what to do) and optional `anti_pattern` (what not to do). Status: `proposed`, `active`, `deprecated`. Tracks sync timestamps for SOUL.md and governance integration.

#### OrgPrincipleEvidence

Join table linking principles to their supporting patterns (many-to-many).

#### MeetingIngestion

Tracks ingested meeting transcripts from external providers (Granola, Otter.ai, Fireflies.ai, manual upload). Stores transcript, participants, and extraction metadata.

---

## pgvector

pgvector adds vector data types and similarity search operators to PostgreSQL. Hearth uses it for:

1. **Memory search** — Find relevant memory entries by semantic similarity to the current conversation
2. **Decision search** — Find related past decisions when making new ones
3. **Skill matching** — Match user intent to the most relevant skill

### Index Configuration

```sql
-- IVFFlat index for approximate nearest neighbor search
CREATE INDEX idx_memory_embedding ON memory_entries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

The `lists` parameter controls the number of clusters. For datasets under 1 million rows, 100 lists provides a good balance of speed and recall. Increase for larger datasets.

### Flexible Dimensions

The embedding column is defined as `vector` without a fixed dimension constraint. This means the IVFFlat index must be created after data is inserted (pgvector infers the dimension from existing data). When changing embedding providers or dimensions:

1. Drop the existing index
2. Clear or regenerate embeddings with the new dimension
3. Recreate the index

The embedding service handles dimension differences transparently — it generates embeddings at whatever dimension the configured provider produces.

### Similarity Operators

| Operator | Description |
|---|---|
| `<=>` | Cosine distance (1 - cosine similarity) |
| `<->` | Euclidean (L2) distance |
| `<#>` | Negative inner product |

Hearth uses cosine distance (`<=>`) for all similarity searches.

---

## Migrations

Prisma manages database migrations. Each migration is a SQL file in `apps/api/prisma/migrations/`.

```bash
# Create a migration after changing schema.prisma
pnpm db:migrate

# Apply pending migrations (production)
npx prisma migrate deploy

# Reset the database (destroys all data)
npx prisma migrate reset

# View migration status
npx prisma migrate status
```

### Migration History

| Migration | Description |
|---|---|
| `20260414114044_init` | Initial schema: users, orgs, teams, chat sessions, messages, tasks, memory, identity, skills, routines, integrations, audit logs |
| `20260414150000_phase2_session_shares_and_search_indexes` | Session sharing and full-text search indexes on messages |
| `20260414_phase3_skill_source_task` | Links skills to their source task for agent-proposed skill tracking |
| `20260415000000_collaborative_sharing` | Session collaborators for multiplayer chat |
| `20260415100000_skill_unique_org_name` | Unique constraint on `(org_id, name)` for skills |
| `20260415110000_drop_skill_version` | Removes legacy version field from skills |
| `20260416000000_task_reviews_and_phase` | Task reviews (approved/changes_requested) and execution step phases (planning/execution) |
| `20260416100000_flexible_embedding_dimension` | Removes fixed 1536-dimension constraint from memory embeddings, allowing any embedding provider |
| `20260416200000_add_artifacts` | Artifacts and artifact versions for persistent content objects in chat sessions |
| `20260417100000_add_chat_attachments` | File attachments on chat messages with metadata (filename, mime type, size, dimensions) |
| `20260418000000_add_activity_reactions` | Emoji reactions on activity feed events (audit log entries) |
| `20260418100000_routines_enhancement` | Comprehensive routines upgrade: run-to-run state, event-driven triggers (webhook endpoints, routine triggers), team scoping, parameterized routines, approval gates (checkpoints, requests), cross-routine chaining, pipeline runs, and health monitoring alerts |
| `20260418200000_add_governance` | Governance policies and violation tracking with configurable enforcement |
| `20260418300000_add_agent_experiences` | Agent experience records for self-evolving learning loop, auto-generated skill proposals |
| `20260419000000_add_cognitive_profiles` | Cognitive profiles and thought patterns for the Digital Co-Worker feature |
| `20260420000000_add_context_graph` | Context Graph — 9 enums, 9 tables (decisions, decision_contexts, decision_links, decision_outcomes, decision_patterns, decision_pattern_links, org_principles, org_principle_evidence, meeting_ingestions), vector/FTS/B-tree indexes |

### Migration Best Practices

- Always create a migration for schema changes — never modify the database directly
- Review the generated SQL before applying in production
- Test migrations against a copy of production data
- Back up the database before running migrations in production
- Migrations are forward-only in production — use `prisma migrate deploy`, not `prisma migrate dev`

---

## Entity Relationship Overview

```
Org
 ├── Team[] ── User[]
 ├── Integration[] ── WebhookEndpoint[] ── RoutineTrigger[]
 ├── Skill[]
 ├── Routine[] ── RoutineRun[] ── ApprovalRequest[]
 │    ├── RoutineTrigger[]
 │    ├── ApprovalCheckpoint[]
 │    ├── RoutineChain[] (from/to)
 │    └── RoutineHealthAlert[]
 ├── MemoryEntry[]
 ├── AgentIdentity[]
 ├── AuditLog[] ── ActivityReaction[]
 ├── GovernancePolicy[] ── GovernanceViolation[]
 ├── CognitiveProfile[]
 ├── ThoughtPattern[]
 ├── Decision[] ── DecisionContext[], DecisionLink[], DecisionOutcome[]
 │    └── DecisionPatternLink[]
 ├── DecisionPattern[] ── DecisionPatternLink[], OrgPrincipleEvidence[]
 ├── OrgPrinciple[] ── OrgPrincipleEvidence[]
 └── Settings (JSONB)

User
 ├── ChatSession[] ── ChatMessage[] ── ChatAttachment[]
 │    ├── SessionCollaborator[]
 │    ├── SessionShare[]
 │    └── Artifact[] ── ArtifactVersion[]
 ├── Task[] ── TaskComment[], TaskExecutionStep[], TaskReview[]
 ├── MemoryEntry[]
 ├── UserSkill[]
 ├── Routine[]
 ├── CognitiveProfile[]
 ├── ThoughtPattern[]
 ├── Decision[] (created)
 ├── DecisionOutcome[] (observed)
 └── ActivityReaction[]
```
