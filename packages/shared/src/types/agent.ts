/**
 * Shared contracts for the agent-loop modernization effort (opencode/openchamber
 * adaptation). These types are defined up front in Wave 0 so the parallel
 * workstreams (W1 provider layer, W2 interruptibility, W3 permissions, W4
 * plan/build, W5 model picker, W6 slash commands) all code against a stable
 * surface and don't collide on the shared types.
 *
 * See plans/opencode-adaptation-plan.md.
 */

// ── W4: Plan → Build ──────────────────────────────────────────────────────────

/**
 * Agent operating mode for a chat run.
 * - `plan`  : read-only; side-effecting tools are denied by policy; produces a
 *             numbered plan for the user to approve.
 * - `build` : full tools (still W3-gated); may be seeded with an approved plan.
 */
export type AgentMode = 'plan' | 'build';

// ── W3: Per-tool permission policy ─────────────────────────────────────────────

/** How a tool call is gated. */
export type ToolPermissionLevel = 'allow' | 'ask' | 'deny';

/** The user's answer to a `permission_request`. */
export type ToolPermissionDecision = 'allow_once' | 'allow_always' | 'deny';

/**
 * One policy rule. Rules are evaluated in order; first match wins. Scope
 * precedence (highest first): user override (narrowing only) → agent profile →
 * org default.
 */
export interface PermissionRule {
  /** Glob against the tool name, e.g. `slack_post_message`, `*_delete`, `recall_*`. */
  toolPattern: string;
  /** Optional structural match against the tool input (subset match). */
  argPattern?: Record<string, unknown>;
  level: ToolPermissionLevel;
  /** When false, a user-scope rule may not widen this (e.g. org hard-deny). */
  userScopeOverridable?: boolean;
}

/** Client → server reply to a `permission_request` ChatEvent. */
export interface PermissionResponse {
  callId: string;
  decision: ToolPermissionDecision;
}

// ── W1 / W5: Model catalog (models.dev-backed) ─────────────────────────────────

export interface ModelCaps {
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
}

/** Per-1M-token pricing hints sourced from the catalog (USD). */
export interface ModelPricing {
  inputPer1M?: number;
  outputPer1M?: number;
}

/**
 * A resolved entry from the model catalog. `resolveModel(id)` returns this or
 * throws `UnknownModelError` — never a silent fallback (kills the undated
 * `claude-haiku-4-5` → gpt-4o bug).
 */
export interface CatalogModel {
  id: string;
  providerId: string;
  contextWindow: number;
  caps: ModelCaps;
  pricing?: ModelPricing;
}

/** Shape returned by `GET /api/v1/models` for the in-chat picker (W5). */
export interface ModelPickerEntry extends CatalogModel {
  /** Cheap display hint derived from pricing: `$`, `$$`, `$$$`. */
  costHint?: string;
  /** Whether the requesting user's role is allowed to select this model. */
  allowedForRole: boolean;
}

// ── Feature flags (per-org, stored under org.settings.features) ────────────────

export interface OrgFeatureFlags {
  /** W2 — interruptible/steerable runs + stop control. */
  interruptible?: boolean;
  /** W3 — interactive per-tool permission prompts. */
  permissions?: boolean;
  /** W4 — Plan → Build mode. */
  planMode?: boolean;
  /** W5 — in-chat model picker. */
  modelPicker?: boolean;
  /** W6 — extensible slash commands. */
  slashCommands?: boolean;
}

export type OrgFeatureFlag = keyof OrgFeatureFlags;

// ── Slash commands (W6) ────────────────────────────────────────────────────────

/**
 * What kind of command a `/` entry is. Built-ins are hardcoded in the registry;
 * `skill` entries are user/org Skills flagged `invocableAsCommand`.
 */
export type SlashCommandKind = 'builtin' | 'skill';

/**
 * A client-facing slash command descriptor. The `/` menu renders a list of these
 * (built-ins + the org's invocable skills); the client dispatches by `action` for
 * built-ins (handled locally) or sends `/slug args` to the server for skills.
 */
export interface SlashCommand {
  /** The slug typed after `/` (e.g. `task`, `plan`, `standup`). Unique in the list. */
  slug: string;
  /** Short human label shown in the menu. */
  title: string;
  /** One-line description shown under the title. */
  description: string;
  kind: SlashCommandKind;
  /**
   * For built-ins: a stable action id the client switches on (`task`, `plan`,
   * `model`, `share`, `new`, `skill`). For skill entries this is always `skill`.
   */
  action: SlashBuiltinAction;
  /** For skill entries: the backing skill id (so the client can resolve it). */
  skillId?: string;
}

/** The fixed set of built-in command actions the client knows how to dispatch. */
export type SlashBuiltinAction = 'task' | 'plan' | 'model' | 'share' | 'new' | 'skill';

