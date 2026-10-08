import type { AgentMode, PermissionRule } from '@hearth/shared';

/**
 * Agent profiles (W4 of the opencode adaptation).
 *
 * A profile is a small, DATA definition of an operating mode: it carries a
 * stable id, the `AgentMode` it maps to, an ordered set of W3 `PermissionRule`s
 * that scope the *agent layer* of the permission policy, and a system-prompt
 * addendum. Modes are "agents, and agents are data" (see plans §2.3).
 *
 * The two built-ins — `plan` and `build` — are defined here rather than in a new
 * DB table: they are product-level constants, identical for every org, and the
 * W3 `tool_permission_policies` table already models profile-scoped rules via
 * its `agent_profile_id` column for any org-authored profiles added later.
 * Keeping the built-ins in code means no per-org seeding is required for the
 * read-only guarantee to hold, and the enforcement reuses the EXACT same W3
 * mechanism (agent-layer rules fed to `evaluateToolCall`) — no parallel
 * restriction path.
 *
 * Read-only enforcement for `plan`:
 *   The agent layer denies every write/side-effect tool and allows only
 *   read/recall/search tools (plus the planning-output tool). Because the W3
 *   evaluator lets the agent layer REPLACE the org/default base decision when it
 *   matches, these rules make writes a hard `deny` regardless of the org policy
 *   — a write tool requested in plan mode returns `blocked_by_policy` and never
 *   runs, so no side effect can leak.
 */

export const PLAN_PROFILE_ID = 'builtin:plan';
export const BUILD_PROFILE_ID = 'builtin:build';

export interface AgentProfile {
  id: string;
  mode: AgentMode;
  /** Agent-layer permission rules (fed to evaluateToolCall as `agentRules`). */
  rules: PermissionRule[];
  /** Appended to the system prompt for runs under this profile. */
  promptAddendum: string;
}

/**
 * Plan profile — READ-ONLY. First-match-wins, so the write/side-effect denies
 * come before the broad read allows. The trailing `*` → deny makes anything not
 * explicitly recognized as a read also denied (fail-closed for planning).
 */
const PLAN_RULES: PermissionRule[] = [
  // The planning-output tool is always allowed so the agent can emit its plan.
  { toolPattern: 'submit_plan', level: 'allow' },
  // Reads / recall / search / get / list — the only side-effect-free verbs.
  { toolPattern: 'recall_*', level: 'allow' },
  { toolPattern: 'get_*', level: 'allow' },
  { toolPattern: 'search_*', level: 'allow' },
  { toolPattern: '*_search', level: 'allow' },
  { toolPattern: 'list_*', level: 'allow' },
  { toolPattern: 'web_fetch', level: 'allow' },
  { toolPattern: 'web_search', level: 'allow' },
  { toolPattern: 'read_file', level: 'allow' },
  { toolPattern: 'clarify', level: 'allow' },
  // Everything else — writes, sends, creates, MCP calls, code execution,
  // sub-agents, deletes — is denied while planning. Non-overridable: a user
  // cannot widen a plan-mode deny mid-plan.
  { toolPattern: '*', level: 'deny', userScopeOverridable: false },
];

const PLAN_ADDENDUM = `## Plan mode (read-only)

You are operating in PLAN MODE. You must NOT execute, send, create, modify, or
delete anything. Write and side-effecting tools are disabled by policy and will
be refused — do not attempt them.

Your job is to research (reads, search, recall are allowed) and then produce a
clear, actionable, NUMBERED plan of the concrete steps you WOULD take to fulfil
the request. Each step should be a single, verifiable action.

When your plan is ready, call the \`submit_plan\` tool exactly once with the
ordered steps. Do not narrate the plan in prose in addition to submitting it —
submit the structured steps. If the request needs no action (it is a question,
or there is nothing to do), submit an empty plan and say so briefly.`;

const BUILD_ADDENDUM = `## Build mode

You are operating in BUILD MODE: full tools are available (still subject to the
organization's permission policy — some actions may ask for confirmation). If an
approved plan was provided above, execute its steps in order; otherwise proceed
as usual.`;

export const PLAN_PROFILE: AgentProfile = {
  id: PLAN_PROFILE_ID,
  mode: 'plan',
  rules: PLAN_RULES,
  promptAddendum: PLAN_ADDENDUM,
};

export const BUILD_PROFILE: AgentProfile = {
  id: BUILD_PROFILE_ID,
  mode: 'build',
  // Build adds no agent-layer restrictions — the org/default + user layers (W3)
  // govern it entirely.
  rules: [],
  promptAddendum: BUILD_ADDENDUM,
};

/** Resolve the built-in profile id for a mode. Undefined mode → build. */
export function profileIdForMode(mode: AgentMode | undefined): string {
  return mode === 'plan' ? PLAN_PROFILE_ID : BUILD_PROFILE_ID;
}

/** Look up a built-in profile by id. Returns undefined for unknown/org ids. */
export function getBuiltinProfile(id: string | null | undefined): AgentProfile | undefined {
  if (id === PLAN_PROFILE_ID) return PLAN_PROFILE;
  if (id === BUILD_PROFILE_ID) return BUILD_PROFILE;
  return undefined;
}
