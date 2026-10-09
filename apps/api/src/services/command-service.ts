import type { SlashCommand } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import {
  BUILTIN_COMMANDS,
  resolveCommand,
  skillToSlashCommand,
  toSkillCommand,
  type CommandResolution,
  type ParsedCommand,
  type SkillCommand,
} from './command-registry.js';

/**
 * W6 — DB-facing wrapper around the pure command registry.
 *
 * Reads the org's invocable Skills and connected integrations, then delegates
 * the listing + resolution logic to `command-registry.ts` (which stays pure so
 * it's trivially unit-tested).
 */

/** Load the org's skills that are exposed as `/` commands (published only). */
export async function listSkillCommands(orgId: string): Promise<SkillCommand[]> {
  const rows = await prisma.skill.findMany({
    where: { orgId, invocableAsCommand: true, status: 'published', NOT: { commandSlug: null } },
    select: {
      id: true,
      name: true,
      content: true,
      invocableAsCommand: true,
      commandSlug: true,
      commandParams: true,
      requiredIntegrations: true,
    },
    orderBy: { commandSlug: 'asc' },
  });
  return rows.map(toSkillCommand).filter((c): c is SkillCommand => c !== null);
}

/** The set of provider ids the org has an active, enabled integration for. */
export async function connectedIntegrations(orgId: string): Promise<Set<string>> {
  const rows = await prisma.integration.findMany({
    where: { orgId, enabled: true, status: 'active' },
    select: { provider: true },
  });
  return new Set(rows.map((r) => r.provider));
}

/**
 * The full client-facing command list for the `/` menu: built-ins + the org's
 * invocable skills. Returned in a stable order (built-ins first, then skills
 * alphabetically by slug) so the menu never reorders between keystrokes.
 */
export async function listCommands(orgId: string): Promise<SlashCommand[]> {
  const skills = await listSkillCommands(orgId);
  return [...BUILTIN_COMMANDS, ...skills.map(skillToSlashCommand)];
}

/** Resolve a parsed `/slug args` for an org (throws `CommandResolveError`). */
export async function resolveCommandForOrg(
  orgId: string,
  parsed: ParsedCommand,
): Promise<CommandResolution> {
  const [skills, connected] = await Promise.all([
    listSkillCommands(orgId),
    connectedIntegrations(orgId),
  ]);
  return resolveCommand(parsed, { skills, connectedIntegrations: connected });
}
