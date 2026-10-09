import { prisma } from '../lib/prisma.js';
import { buildSystemPrompt, type CitationSource } from './system-prompt.js';
import { createToolRouter } from './tool-router.js';
import type { AgentContext, AgentPlan } from './types.js';
import { profileIdForMode } from './agent-profiles.js';
import type { RoutineRunContext } from '../services/routine-context-service.js';
import type { AgentMode, NormalizedEvent } from '@hearth/shared';

export interface BuildAgentContextOpts {
  routineRunContext?: RoutineRunContext;
  triggerEvent?: NormalizedEvent;
  routineId?: string;
  cognitiveQuerySubjectId?: string;
  timezone?: string;
  /** W4: plan/build mode. Undefined → build (today's behavior). */
  agentMode?: AgentMode;
  /** W4: invoked by `submit_plan` with the structured plan (plan mode only). */
  onPlanSubmitted?: (plan: AgentPlan) => void;
  /**
   * W4: an approved plan to seed a build run with. Rendered into the system
   * prompt so the build agent executes the approved steps in order.
   */
  approvedPlan?: AgentPlan;
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

  const agentMode = opts?.agentMode;

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
    agentMode,
    approvedPlan: opts?.approvedPlan,
  };

  const [promptResult, toolMap] = await Promise.all([
    buildSystemPrompt(partialContext),
    createToolRouter({
      userId,
      orgId,
      teamId: teamId ?? null,
      sessionId,
      routineId: opts?.routineId,
      visionEnabled,
      agentMode,
      onPlanSubmitted: opts?.onPlanSubmitted,
    }),
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
    // W4: plan/build. agentProfileId drives the W3 agent-layer policy (read-only
    // for plan). Undefined mode resolves to the build profile.
    agentMode,
    agentProfileId: agentMode ? profileIdForMode(agentMode) : undefined,
    onPlanSubmitted: opts?.onPlanSubmitted,
    systemPrompt: promptResult.prompt,
    sources: promptResult.sources,
    tools,
  };
}
