import { prisma } from '../lib/prisma.js';
import { buildSystemPrompt, type CitationSource } from './system-prompt.js';
import { createToolRouter } from './tool-router.js';
import type { AgentContext } from './types.js';
import type { RoutineRunContext } from '../services/routine-context-service.js';
import type { NormalizedEvent } from '@hearth/shared';

export interface BuildAgentContextOpts {
  routineRunContext?: RoutineRunContext;
  triggerEvent?: NormalizedEvent;
  routineId?: string;
  cognitiveQuerySubjectId?: string;
  timezone?: string;
}

/**
 * Builds a full AgentContext by querying DB for user/org/team info,
 * constructing the system prompt, and assembling available tools.
 */
export async function buildAgentContext(
  userId: string,
  sessionId: string,
  latestMessage?: string,
  activeArtifactId?: string,
  opts?: BuildAgentContextOpts,
): Promise<AgentContext> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { team: { select: { orgId: true } } },
  });

  const teamId = user.teamId;
  // Prefer the team's orgId; fall back to the first org in the system (admins without a team)
  const org =
    user.team?.orgId
      ? await prisma.org.findUnique({ where: { id: user.team.orgId }, select: { id: true, settings: true } })
      : await prisma.org.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, settings: true } });
  const orgId = org?.id ?? '';

  // Read org-level LLM settings (vision toggle)
  const orgSettings = (org?.settings as Record<string, unknown>) ?? {};
  const llmSettings = (orgSettings.llm ?? {}) as Record<string, unknown>;
  const visionEnabled = (llmSettings.visionEnabled as boolean | undefined) ?? true;

  const partialContext: Partial<AgentContext> = {
    userId,
    orgId,
    teamId,
    sessionId,
    latestMessage,
    activeArtifactId,
    timezone: opts?.timezone,
    routineRunContext: opts?.routineRunContext,
    triggerEvent: opts?.triggerEvent,
    routineId: opts?.routineId,
    cognitiveQuerySubjectId: opts?.cognitiveQuerySubjectId,
  };

  const [promptResult, toolMap] = await Promise.all([
    buildSystemPrompt(partialContext),
    createToolRouter({ userId, orgId, teamId: teamId ?? null, sessionId, routineId: opts?.routineId, visionEnabled }),
  ]);
  const tools = Array.from(toolMap.values());

  return {
    userId,
    orgId,
    teamId,
    sessionId,
    latestMessage,
    visionEnabled,
    timezone: opts?.timezone,
    routineRunContext: opts?.routineRunContext,
    triggerEvent: opts?.triggerEvent,
    routineId: opts?.routineId,
    cognitiveQuerySubjectId: opts?.cognitiveQuerySubjectId,
    systemPrompt: promptResult.prompt,
    sources: promptResult.sources,
    tools,
  };
}
