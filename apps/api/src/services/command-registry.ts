import type {
  RoutineParameter,
  SlashCommand,
  SlashBuiltinAction,
} from '@hearth/shared';

/**
 * W6 — Slash command registry.
 *
 * The single source of truth for what `/` commands exist. Built-ins are static;
 * user/org commands are Skills flagged `invocableAsCommand` with a `commandSlug`.
 *
 * This module is pure/transport-free so it can be unit-tested and reused by both
 * the `/commands` listing endpoint and the message send path. It owns:
 *   - the built-in command list,
 *   - parsing a raw `/slug rest` input,
 *   - resolving a slug to a command (built-in or skill),
 *   - validating positional args against a skill's parameter template,
 *   - expanding a skill into a prompt.
 *
 * Error branches are explicit and typed so the caller can turn each into an
 * INLINE error — an unknown command / missing param / missing integration is
 * NEVER forwarded to the agent as a prompt.
 */

// ── Built-in commands ───────────────────────────────────────────────────────

/**
 * Built-in slash commands. `/task`, `/plan`, `/model`, `/share`, `/new` are
 * dispatched entirely client-side (they toggle W4 plan mode, open the W5 picker,
 * etc.). `/skill <slug> args` is a generic launcher that resolves a skill by its
 * *name* and runs it (distinct from a skill that has been promoted to its own
 * top-level slug via `invocableAsCommand`).
 */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  { slug: 'task', title: '/task', description: 'Open the task composer', kind: 'builtin', action: 'task' },
  { slug: 'plan', title: '/plan', description: 'Toggle plan mode (produce a plan to approve)', kind: 'builtin', action: 'plan' },
  { slug: 'model', title: '/model', description: 'Choose the model for this run', kind: 'builtin', action: 'model' },
  { slug: 'share', title: '/share', description: 'Share this conversation', kind: 'builtin', action: 'share' },
  { slug: 'new', title: '/new', description: 'Start a new conversation', kind: 'builtin', action: 'new' },
  { slug: 'skill', title: '/skill', description: 'Run a skill by name: /skill <name> [args]', kind: 'builtin', action: 'skill' },
] as const;

const BUILTIN_SLUGS = new Set(BUILTIN_COMMANDS.map((c) => c.slug));

/** Whether `slug` is a reserved built-in (so a skill can't shadow it). */
export function isBuiltinSlug(slug: string): boolean {
  return BUILTIN_SLUGS.has(slug.toLowerCase());
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export interface ParsedCommand {
  /** The slug typed after the leading `/`, lower-cased. */
  slug: string;
  /** Everything after the slug (trimmed). Empty string when no args were given. */
  rest: string;
}

/**
 * Parse a raw composer value into a command, or `null` when it isn't a command
 * (doesn't start with `/`, or is just `/`). Only a single leading `/token` is
 * treated as a command trigger — regular prose with a slash mid-sentence is not.
 */
export function parseCommandInput(raw: string): ParsedCommand | null {
  const trimmed = raw.trim();
  const m = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!m) return null;
  return { slug: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

// ── Skill-command shape (subset of the Skill row we need) ─────────────────────

export interface SkillCommand {
  id: string;
  name: string;
  content: string;
  commandSlug: string;
  commandParams: RoutineParameter[];
  requiredIntegrations: string[];
}

/**
 * Narrow a raw skill row (as read from Prisma) into a `SkillCommand`, coercing
 * the JSON `commandParams` into a `RoutineParameter[]`. Returns `null` when the
 * row isn't actually invocable as a command (defensive — the query should
 * already filter these out).
 */
export function toSkillCommand(row: {
  id: string;
  name: string;
  content: string;
  invocableAsCommand: boolean;
  commandSlug: string | null;
  commandParams: unknown;
  requiredIntegrations: string[];
}): SkillCommand | null {
  if (!row.invocableAsCommand || !row.commandSlug) return null;
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    commandSlug: row.commandSlug,
    commandParams: coerceParams(row.commandParams),
    requiredIntegrations: row.requiredIntegrations ?? [],
  };
}

function coerceParams(value: unknown): RoutineParameter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is RoutineParameter =>
      !!p && typeof p === 'object' && typeof (p as RoutineParameter).name === 'string',
  );
}

/** Build the client-facing `SlashCommand` descriptor for a skill command. */
export function skillToSlashCommand(skill: SkillCommand): SlashCommand {
  return {
    slug: skill.commandSlug,
    title: `/${skill.commandSlug}`,
    description: `Run the "${skill.name}" skill`,
    kind: 'skill',
    action: 'skill',
    skillId: skill.id,
  };
}

// ── Resolution ────────────────────────────────────────────────────────────────

export type ResolveErrorCode =
  | 'UNKNOWN_COMMAND'
  | 'MISSING_PARAMS'
  | 'MISSING_INTEGRATION';

export class CommandResolveError extends Error {
  readonly status = 422;
  constructor(
    public readonly code: ResolveErrorCode,
    message: string,
    /** Extra structured context for the inline UI (e.g. the integration to connect). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CommandResolveError';
  }
}

export interface BuiltinResolution {
  type: 'builtin';
  action: SlashBuiltinAction;
  rest: string;
}

export interface SkillResolution {
  type: 'skill';
  skillId: string;
  /** The prompt to send to the agent (skill content with args substituted). */
  prompt: string;
  /** Parsed args keyed by parameter name (for audit/metadata). */
  args: Record<string, string>;
}

export type CommandResolution = BuiltinResolution | SkillResolution;

/**
 * Resolve a parsed `/slug args` against the built-ins + the org's invocable
 * skills.
 *
 * Throws `CommandResolveError` for every failure branch so the caller can emit
 * an INLINE error and NEVER start a run / forward the text to the agent:
 *   - `UNKNOWN_COMMAND`     — slug isn't a built-in and isn't an invocable skill.
 *   - `MISSING_PARAMS`      — a required skill parameter wasn't supplied.
 *   - `MISSING_INTEGRATION` — the skill needs an integration the org hasn't
 *                             connected (details carry the provider to connect).
 */
export function resolveCommand(
  parsed: ParsedCommand,
  ctx: {
    skills: SkillCommand[];
    connectedIntegrations: Set<string>;
  },
): CommandResolution {
  // Built-ins win — a skill can never shadow a built-in slug (also enforced at
  // save time), so this ordering can't hide a user command.
  const builtin = BUILTIN_COMMANDS.find((c) => c.slug === parsed.slug);
  if (builtin) {
    return { type: 'builtin', action: builtin.action, rest: parsed.rest };
  }

  const skill = ctx.skills.find((s) => s.commandSlug === parsed.slug);
  if (!skill) {
    throw new CommandResolveError(
      'UNKNOWN_COMMAND',
      `Unknown command: /${parsed.slug}`,
      { slug: parsed.slug },
    );
  }

  // Integration gate — fail with an actionable "connect X" message, no run.
  const missing = skill.requiredIntegrations.find((p) => !ctx.connectedIntegrations.has(p));
  if (missing) {
    throw new CommandResolveError(
      'MISSING_INTEGRATION',
      `This command needs ${missing}. Connect ${missing} first.`,
      { provider: missing, skillId: skill.id },
    );
  }

  const { args } = validateSkillArgs(skill, parsed.rest);
  return {
    type: 'skill',
    skillId: skill.id,
    prompt: expandSkillPrompt(skill, args),
    args,
  };
}

// ── Parameter validation ──────────────────────────────────────────────────────

/**
 * Validate the positional `rest` string against a skill's parameter template.
 *
 * Args are positional and whitespace-separated, mapping to `commandParams` in
 * order (the last declared param greedily absorbs any trailing words, so a free-
 * text final param works). Missing required params throw `MISSING_PARAMS` with
 * the names so the UI can prompt inline. Optional params fall back to `default`.
 */
export function validateSkillArgs(
  skill: SkillCommand,
  rest: string,
): { args: Record<string, string> } {
  const params = skill.commandParams;
  const args: Record<string, string> = {};

  if (params.length === 0) {
    // No template — the whole rest is a freeform "args" value, nothing required.
    if (rest) args.args = rest;
    return { args };
  }

  const tokens = rest.length > 0 ? rest.split(/\s+/) : [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const isLast = i === params.length - 1;
    // The last param greedily takes the remaining tokens (free-text tail).
    const raw = isLast ? tokens.slice(i).join(' ') : tokens[i];
    if (raw !== undefined && raw !== '') {
      args[p.name] = raw;
    } else if (p.default !== undefined && p.default !== null) {
      args[p.name] = String(p.default);
    }
  }

  const missing = params
    .filter((p) => p.required && (args[p.name] === undefined || args[p.name] === ''))
    .map((p) => p.name);

  if (missing.length > 0) {
    throw new CommandResolveError(
      'MISSING_PARAMS',
      `Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      { missing, params },
    );
  }

  return { args };
}

/**
 * Expand a skill into the prompt sent to the agent. Substitutes `{{param}}`
 * placeholders in the skill content with the supplied args, then appends an
 * explicit args block so the model always sees the invocation even when the
 * content has no placeholders.
 */
export function expandSkillPrompt(skill: SkillCommand, args: Record<string, string>): string {
  let body = skill.content;
  for (const [name, value] of Object.entries(args)) {
    body = body.replaceAll(`{{${name}}}`, value);
  }
  const argLines = Object.entries(args)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const header = `Run the "${skill.name}" skill.`;
  return argLines ? `${header}\n\nArguments:\n${argLines}\n\n${body}` : `${header}\n\n${body}`;
}
