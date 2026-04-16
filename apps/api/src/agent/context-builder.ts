import { prisma } from '../lib/prisma.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createToolRouter } from './tool-router.js';
import type { AgentContext } from './types.js';

/**
 * Builds a full AgentContext by querying DB for user/org/team info,
 * constructing the system prompt, and assembling available tools.
 */
export async function buildAgentContext(
  userId: string,
  sessionId: string,
  latestMessage?: string,
): Promise<AgentContext> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { team: { select: { orgId: true } } },
  });

  const teamId = user.teamId;
  // Prefer the team's orgId; fall back to the first org in the system (admins without a team)
  const orgId =
    user.team?.orgId ??
    (await prisma.org.findFirst({ orderBy: { createdAt: 'asc' } }))?.id ??
    '';

  const partialContext = {
    userId,
    orgId,
    teamId,
    sessionId,
    latestMessage,
  };

  const [systemPrompt, toolMap] = await Promise.all([
    buildSystemPrompt(partialContext),
    createToolRouter({ userId, orgId, teamId: teamId ?? null }),
  ]);
  const tools = Array.from(toolMap.values());

  return {
    userId,
    orgId,
    teamId,
    sessionId,
    latestMessage,
    systemPrompt,
    tools,
  };
}
