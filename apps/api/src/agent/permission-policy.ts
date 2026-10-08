import type { PermissionRule, ToolPermissionLevel } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

/**
 * Per-tool permission policy (W3 of the opencode adaptation).
 *
 * Evaluates a tool call against an ordered list of `PermissionRule`s. A rule
 * matches when its `toolPattern` glob matches the tool name AND (if present) its
 * `argPattern` is a structural subset of the tool input. The FIRST matching rule
 * in evaluation order wins.
 *
 * Scope precedence (highest first): user override → agent profile → org default.
 * A user-scope rule may only NARROW (make stricter): it may tighten an
 * `allow`/`ask` toward `ask`/`deny`, but it may NOT widen a rule the org marked
 * non-overridable (`userScopeOverridable: false`) — an org hard-deny stays deny
 * no matter what the user asks for.
 *
 * These interactive asks sit BELOW Hearth's durable routine-approval gates and
 * are ephemeral (WS + in-memory), not persisted approvals.
 */

// ── Hearth default policy ──────────────────────────────────────────────────
//
// Not bash-centric (opencode's taxonomy). Hearth's tools are read/recall/search
// (safe), task/routine/memory mutations (local, safe), external side-effects
// (ask), and destructive/admin (deny). Order matters: more specific / stricter
// patterns come first so a destructive verb isn't swallowed by a broad write
// rule. Evaluated first-match-wins.
export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  // Destructive + integration admin — hard deny, not user-overridable.
  { toolPattern: '*_delete', level: 'deny', userScopeOverridable: false },
  { toolPattern: 'integration_*', level: 'deny', userScopeOverridable: false },
  // External side-effects — ask the user before firing.
  { toolPattern: 'slack_post_message', level: 'ask' },
  { toolPattern: 'jira_create_issue', level: 'ask' },
  { toolPattern: 'send_email', level: 'ask' },
  { toolPattern: '*_create', level: 'ask' },
  { toolPattern: '*_update', level: 'ask' },
  // MCP writes (mcp__provider__send/post/create/...) — ask.
  { toolPattern: 'mcp__*', argPattern: undefined, level: 'ask' },
  // Reads / recall / search / get — allow.
  { toolPattern: 'recall_*', level: 'allow' },
  { toolPattern: 'get_*', level: 'allow' },
  { toolPattern: 'search_*', level: 'allow' },
  { toolPattern: '*_search', level: 'allow' },
  { toolPattern: 'list_*', level: 'allow' },
  // Everything else Hearth-native (local, safe: save_memory, create_task,
  // artifacts, clarify, decisions, ...) — allow. This is the fallthrough.
  { toolPattern: '*', level: 'allow' },
];

/** The scope a rule came from. Drives precedence and overridability. */
export type RuleScope = 'user' | 'agent' | 'org' | 'default';

export interface ScopedRule extends PermissionRule {
  scope: RuleScope;
}

export interface PermissionDecisionResult {
  level: ToolPermissionLevel;
  /** The rule that decided it (for audit/UI). */
  matchedRule?: ScopedRule;
  /**
   * True when the client should NOT be offered an `allow_always`/`allow_once`
   * option because the org marked the matched deny non-overridable.
   */
  nonOverridable: boolean;
}

// Strictness ordering for the "user can only narrow" rule.
const STRICTNESS: Record<ToolPermissionLevel, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * Convert a glob (`*` = any run of chars, `?` = one char) to a RegExp. Only
 * `*` and `?` are special; everything else is matched literally.
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`);
}

function toolNameMatches(pattern: string, toolName: string): boolean {
  return globToRegExp(pattern).test(toolName);
}

/**
 * Structural subset match: every key in `argPattern` must be present in `input`
 * and match. String pattern values support globs (so `{ channel: '#sales*' }`
 * matches `{ channel: '#sales-eng' }`). Nested objects recurse. Missing keys or
 * mismatches fail the match (the rule simply doesn't apply).
 */
function argPatternMatches(
  argPattern: Record<string, unknown> | undefined,
  input: Record<string, unknown>,
): boolean {
  if (!argPattern) return true;
  for (const [key, expected] of Object.entries(argPattern)) {
    const actual = input[key];
    if (!valueMatches(expected, actual)) return false;
  }
  return true;
}

function valueMatches(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return actual === expected;
  if (typeof expected === 'string') {
    if (typeof actual !== 'string') return false;
    // Treat a string pattern as a glob only if it contains a wildcard;
    // otherwise require an exact match.
    if (expected.includes('*') || expected.includes('?')) {
      return globToRegExp(expected).test(actual);
    }
    return expected === actual;
  }
  if (typeof expected === 'object' && !Array.isArray(expected)) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
    return argPatternMatches(expected as Record<string, unknown>, actual as Record<string, unknown>);
  }
  return expected === actual;
}

/** First matching rule in a list, or undefined. */
function firstMatch(
  rules: ScopedRule[],
  toolName: string,
  input: Record<string, unknown>,
): ScopedRule | undefined {
  for (const rule of rules) {
    if (toolNameMatches(rule.toolPattern, toolName) && argPatternMatches(rule.argPattern, input)) {
      return rule;
    }
  }
  return undefined;
}

export interface EvaluateInput {
  toolName: string;
  input: Record<string, unknown>;
  /** User override rules (narrowing only). */
  userRules?: PermissionRule[];
  /** Agent-profile rules. */
  agentRules?: PermissionRule[];
  /** Org default rules. Falls back to `DEFAULT_PERMISSION_RULES` when empty. */
  orgRules?: PermissionRule[];
}

/**
 * Evaluate a tool call to a single `allow | ask | deny` decision.
 *
 * Resolution:
 *  1. Find the first match in the org layer (org rules, then built-in defaults).
 *     This establishes the BASE decision + whether it is overridable.
 *  2. Find the first match in the agent-profile layer; if present, it replaces
 *     the base (agent profiles further restrict per the Plan/Build design).
 *  3. Find the first match in the user layer. A user rule applies ONLY if it
 *     NARROWS the current decision (makes it stricter) AND the current decision
 *     is overridable. A user rule may never widen a non-overridable org deny.
 */
export function evaluateToolCall(args: EvaluateInput): PermissionDecisionResult {
  const { toolName, input } = args;

  const orgLayer: ScopedRule[] = [
    ...(args.orgRules ?? []).map((r) => ({ ...r, scope: 'org' as const })),
    ...DEFAULT_PERMISSION_RULES.map((r) => ({ ...r, scope: 'default' as const })),
  ];
  const agentLayer: ScopedRule[] = (args.agentRules ?? []).map((r) => ({ ...r, scope: 'agent' as const }));
  const userLayer: ScopedRule[] = (args.userRules ?? []).map((r) => ({ ...r, scope: 'user' as const }));

  // Base from org/default layer — always matches (defaults end with `*`).
  let matched = firstMatch(orgLayer, toolName, input);
  let level: ToolPermissionLevel = matched?.level ?? 'allow';
  // A rule is overridable unless it explicitly sets userScopeOverridable:false.
  let overridable = matched?.userScopeOverridable !== false;

  // Agent profile layer refines the base (if it matches).
  const agentMatch = firstMatch(agentLayer, toolName, input);
  if (agentMatch) {
    matched = agentMatch;
    level = agentMatch.level;
    // Agent profiles don't relax the org's non-overridable flag.
    overridable = overridable && agentMatch.userScopeOverridable !== false;
  }

  // User layer may only narrow, and only if the current decision is overridable.
  const userMatch = firstMatch(userLayer, toolName, input);
  if (userMatch && overridable && STRICTNESS[userMatch.level] >= STRICTNESS[level]) {
    matched = userMatch;
    level = userMatch.level;
  }

  // nonOverridable is reported true only when the final decision is a deny the
  // org locked — the UI uses this to hide allow options and show "blocked by
  // admin policy".
  const nonOverridable = level === 'deny' && !overridable;

  return { level, matchedRule: matched, nonOverridable };
}

/**
 * Load the ordered rule layers for a (org, agentProfile?, user) tuple from the
 * `tool_permission_policies` table. Rules are returned per-scope, ordered by
 * creation (stable first-match-wins). Best-effort: a DB failure returns empty
 * layers so evaluation falls back to the built-in Hearth defaults.
 */
export async function loadPolicyRules(input: {
  orgId: string;
  agentProfileId?: string | null;
  userId?: string | null;
}): Promise<{ orgRules: PermissionRule[]; agentRules: PermissionRule[]; userRules: PermissionRule[] }> {
  try {
    const rows = await prisma.toolPermissionPolicy.findMany({
      where: {
        orgId: input.orgId,
        OR: [
          { agentProfileId: null, userId: null }, // org default
          ...(input.agentProfileId ? [{ agentProfileId: input.agentProfileId, userId: null }] : []),
          ...(input.userId ? [{ userId: input.userId }] : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    const orgRules: PermissionRule[] = [];
    const agentRules: PermissionRule[] = [];
    const userRules: PermissionRule[] = [];
    for (const row of rows) {
      const rule: PermissionRule = {
        toolPattern: row.toolPattern,
        argPattern: (row.argPattern as Record<string, unknown> | null) ?? undefined,
        level: row.level as ToolPermissionLevel,
        userScopeOverridable: row.userScopeOverridable ?? undefined,
      };
      if (row.userId) userRules.push(rule);
      else if (row.agentProfileId) agentRules.push(rule);
      else orgRules.push(rule);
    }
    return { orgRules, agentRules, userRules };
  } catch (err) {
    logger.warn({ err, orgId: input.orgId }, 'loadPolicyRules failed; falling back to defaults');
    return { orgRules: [], agentRules: [], userRules: [] };
  }
}

/**
 * Persist a user-scope `allow` rule for a tool (the `allow_always` decision).
 * Idempotent-ish: callers may create duplicates, but first-match-wins makes
 * that harmless. Best-effort — a failure is logged, not thrown (the current run
 * still proceeds on the allow_once semantics).
 */
export async function persistUserAllowRule(input: {
  orgId: string;
  userId: string;
  toolName: string;
  createdBy: string;
}): Promise<void> {
  try {
    await prisma.toolPermissionPolicy.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        toolPattern: input.toolName,
        level: 'allow',
        createdBy: input.createdBy,
      },
    });
  } catch (err) {
    logger.warn({ err, tool: input.toolName }, 'persistUserAllowRule failed');
  }
}
