import { describe, it, expect } from 'vitest';
import type { RoutineParameter } from '@hearth/shared';
import {
  BUILTIN_COMMANDS,
  isBuiltinSlug,
  parseCommandInput,
  resolveCommand,
  validateSkillArgs,
  expandSkillPrompt,
  toSkillCommand,
  skillToSlashCommand,
  CommandResolveError,
  type SkillCommand,
} from './command-registry.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function skill(overrides: Partial<SkillCommand> = {}): SkillCommand {
  return {
    id: 'sk_1',
    name: 'Standup',
    content: 'Write a standup for {{date}}.',
    commandSlug: 'standup',
    commandParams: [],
    requiredIntegrations: [],
    ...overrides,
  };
}

const DATE_PARAM: RoutineParameter = { name: 'date', type: 'date', label: 'Date', required: true };

const emptyCtx = { skills: [] as SkillCommand[], connectedIntegrations: new Set<string>() };

// ── Built-ins / registry shape ──────────────────────────────────────────────

describe('command-registry — built-ins', () => {
  it('includes the required built-in slugs (/task, /plan, /model, /share, /new, /skill)', () => {
    const slugs = BUILTIN_COMMANDS.map((c) => c.slug).sort();
    expect(slugs).toEqual(['model', 'new', 'plan', 'share', 'skill', 'task']);
  });

  it('isBuiltinSlug recognizes built-ins and rejects others (case-insensitive)', () => {
    expect(isBuiltinSlug('task')).toBe(true);
    expect(isBuiltinSlug('PLAN')).toBe(true);
    expect(isBuiltinSlug('standup')).toBe(false);
  });
});

describe('command-registry — parseCommandInput', () => {
  it('parses a bare command', () => {
    expect(parseCommandInput('/plan')).toEqual({ slug: 'plan', rest: '' });
  });
  it('parses a command with args and lower-cases the slug', () => {
    expect(parseCommandInput('/Standup 2026-10-08')).toEqual({ slug: 'standup', rest: '2026-10-08' });
  });
  it('returns null for non-commands and a lone slash', () => {
    expect(parseCommandInput('hello world')).toBeNull();
    expect(parseCommandInput('/')).toBeNull();
    expect(parseCommandInput('what about a/b testing')).toBeNull();
  });
});

// ── Case 34: /task opens composer (built-in resolves, not a prompt) ───────────

describe('command-registry — /task regression (case 34, J6)', () => {
  it('resolves /task to the builtin task action with its args preserved', () => {
    const res = resolveCommand(parseCommandInput('/task seed the db')!, emptyCtx);
    expect(res).toEqual({ type: 'builtin', action: 'task', rest: 'seed the db' });
  });
});

// ── Case 35: /skill <slug> args resolves + expands + runs ─────────────────────

describe('command-registry — skill command resolution (case 35)', () => {
  it('resolves a skill slug, validates params, and expands the prompt', () => {
    const s = skill({ commandParams: [DATE_PARAM] });
    const res = resolveCommand(parseCommandInput('/standup 2026-10-08')!, {
      skills: [s],
      connectedIntegrations: new Set(),
    });
    expect(res.type).toBe('skill');
    if (res.type !== 'skill') throw new Error('expected skill');
    expect(res.skillId).toBe('sk_1');
    expect(res.args).toEqual({ date: '2026-10-08' });
    // {{date}} placeholder substituted, args block appended.
    expect(res.prompt).toContain('Write a standup for 2026-10-08.');
    expect(res.prompt).toContain('date: 2026-10-08');
  });

  it('the /skill builtin launcher is itself a builtin action', () => {
    const res = resolveCommand(parseCommandInput('/skill standup')!, emptyCtx);
    expect(res).toEqual({ type: 'builtin', action: 'skill', rest: 'standup' });
  });
});

// ── Case 36 / J6: unknown command → inline error, not sent to agent ───────────

describe('command-registry — unknown command (case 36, J6)', () => {
  it('throws UNKNOWN_COMMAND (never returns a prompt)', () => {
    try {
      resolveCommand(parseCommandInput('/frobnicate now')!, emptyCtx);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CommandResolveError);
      expect((err as CommandResolveError).code).toBe('UNKNOWN_COMMAND');
    }
  });
});

// ── J6: missing required params → inline prompt, run not started ──────────────

describe('command-registry — missing params (J6)', () => {
  it('throws MISSING_PARAMS listing the missing names', () => {
    const s = skill({ commandParams: [DATE_PARAM] });
    try {
      resolveCommand(parseCommandInput('/standup')!, { skills: [s], connectedIntegrations: new Set() });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CommandResolveError);
      const e = err as CommandResolveError;
      expect(e.code).toBe('MISSING_PARAMS');
      expect(e.details?.missing).toEqual(['date']);
    }
  });

  it('uses the param default when an optional arg is omitted', () => {
    const s = skill({
      commandParams: [{ name: 'tone', type: 'string', label: 'Tone', required: false, default: 'friendly' }],
    });
    const res = resolveCommand(parseCommandInput('/standup')!, { skills: [s], connectedIntegrations: new Set() });
    if (res.type !== 'skill') throw new Error('expected skill');
    expect(res.args).toEqual({ tone: 'friendly' });
  });

  it('the last param greedily absorbs a free-text tail', () => {
    const s = skill({
      commandParams: [
        { name: 'channel', type: 'string', label: 'Channel', required: true },
        { name: 'message', type: 'string', label: 'Message', required: true },
      ],
    });
    const res = resolveCommand(parseCommandInput('/standup sales ship it today')!, {
      skills: [s],
      connectedIntegrations: new Set(),
    });
    if (res.type !== 'skill') throw new Error('expected skill');
    expect(res.args).toEqual({ channel: 'sales', message: 'ship it today' });
  });
});

// ── J6: skill needs an unconnected integration → connect X error ──────────────

describe('command-registry — missing integration (J6)', () => {
  it('throws MISSING_INTEGRATION with the provider to connect when not connected', () => {
    const s = skill({ requiredIntegrations: ['jira'] });
    try {
      resolveCommand(parseCommandInput('/standup')!, { skills: [s], connectedIntegrations: new Set() });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CommandResolveError);
      const e = err as CommandResolveError;
      expect(e.code).toBe('MISSING_INTEGRATION');
      expect(e.details?.provider).toBe('jira');
      expect(e.message).toMatch(/connect jira/i);
    }
  });

  it('resolves normally when the required integration IS connected', () => {
    const s = skill({ requiredIntegrations: ['jira'] });
    const res = resolveCommand(parseCommandInput('/standup')!, {
      skills: [s],
      connectedIntegrations: new Set(['jira']),
    });
    expect(res.type).toBe('skill');
  });
});

// ── toSkillCommand / skillToSlashCommand ──────────────────────────────────────

describe('command-registry — row coercion', () => {
  it('toSkillCommand returns null for a non-invocable row', () => {
    expect(
      toSkillCommand({
        id: 'x', name: 'n', content: 'c', invocableAsCommand: false,
        commandSlug: null, commandParams: null, requiredIntegrations: [],
      }),
    ).toBeNull();
  });

  it('toSkillCommand coerces a valid row and params array', () => {
    const c = toSkillCommand({
      id: 'x', name: 'n', content: 'c', invocableAsCommand: true,
      commandSlug: 'standup', commandParams: [DATE_PARAM], requiredIntegrations: ['jira'],
    });
    expect(c).not.toBeNull();
    expect(c!.commandSlug).toBe('standup');
    expect(c!.commandParams).toEqual([DATE_PARAM]);
  });

  it('skillToSlashCommand produces a kind:skill descriptor', () => {
    const cmd = skillToSlashCommand(skill());
    expect(cmd).toMatchObject({ slug: 'standup', kind: 'skill', action: 'skill', skillId: 'sk_1' });
  });
});

describe('command-registry — validateSkillArgs / expandSkillPrompt', () => {
  it('a param-less skill treats the whole rest as a single args value', () => {
    const { args } = validateSkillArgs(skill(), 'anything goes here');
    expect(args).toEqual({ args: 'anything goes here' });
  });

  it('expandSkillPrompt substitutes placeholders and appends an args block', () => {
    const prompt = expandSkillPrompt(skill(), { date: '2026-10-08' });
    expect(prompt).toContain('Write a standup for 2026-10-08.');
    expect(prompt).toContain('- date: 2026-10-08');
  });
});
