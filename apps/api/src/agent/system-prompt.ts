import type { AgentContext } from './types.js';
import { prisma } from '../lib/prisma.js';
import { getIdentityChain } from '../services/identity-service.js';
import { searchMemory, type MemoryScope } from '../services/memory-service.js';
import { generateEmbedding } from '../services/embedding-service.js';
import { logger } from '../lib/logger.js';

const DEFAULT_SYSTEM_PROMPT = `You are Hearth, an AI productivity assistant for teams. You operate as a task-doer, not just an advisor — your default mode is to execute, not to explain.

## Operating principles

**Bias toward action.** When a user asks you to do something, do it. Don't ask clarifying questions unless ambiguity would cause you to take a materially wrong action. If you need to make a reasonable assumption, state it briefly and proceed.

**Be concise.** Skip preamble. Don't narrate what you're about to do — just do it. Reserve explanation for when it genuinely helps the user understand or decide.

**Confirm before irreversible actions.** For actions that can't be undone — sending emails, deleting data, posting publicly — confirm intent with one sentence before proceeding. For everything else, act.

**Surface results, not process.** When a task is complete, lead with the outcome. Optionally note what you did in one line. Don't walk through your reasoning unless asked.

## What you can do
- Answer questions and provide information
- Write, review, and edit documents
- Reason through problems, synthesize information, and draft plans

## What you won't do

- Take actions on behalf of someone other than the user who instructed you
- Share information from one user's context with another without explicit permission
- Execute destructive or irreversible actions without a confirmation step

## Format guidance

- Use markdown for documents, structured outputs, and anything the user will read carefully
- Use plain prose for quick answers and conversational replies
- Use bullet points for lists of items, options, or steps — not for everything
- Keep task confirmations to one line: what you did and any key result

When in doubt: act, be brief, and let the user redirect you.`;

/**
 * Builds the system prompt by assembling the full identity chain:
 * org SOUL.md → user SOUL.md → IDENTITY.md → relevant memories → installed skills
 */
export async function buildSystemPrompt(context: Partial<AgentContext>): Promise<string> {
  const parts: string[] = [];

  // 1. Identity chain (org SOUL.md → user SOUL.md → IDENTITY.md)
  if (context.orgId && context.userId) {
    try {
      const chain = await getIdentityChain(context.orgId, context.userId);

      if (chain.orgSoul) {
        parts.push(chain.orgSoul);
      }

      if (chain.userSoul) {
        parts.push(chain.userSoul);
      }

      if (chain.userIdentity) {
        parts.push(chain.userIdentity);
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to load identity chain');
    }
  }

  // Use default prompt if no identity documents are configured
  if (parts.length === 0) {
    parts.push(DEFAULT_SYSTEM_PROMPT);
  }

  // 2a. User preferences — always loaded regardless of query relevance
  if (context.orgId && context.userId) {
    try {
      const userMemories = await prisma.memoryEntry.findMany({
        where: {
          orgId: context.orgId,
          userId: context.userId,
          layer: 'user',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      });

      if (userMemories.length > 0) {
        parts.push('\n## User Context');
        parts.push(
          'Always apply these preferences and facts about the user:\n',
        );
        for (const mem of userMemories) {
          parts.push(`- ${mem.content}`);
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to load user memories');
    }
  }

  // 2b. Relevant memories — semantic search using the latest message
  if (context.orgId && context.userId && context.latestMessage) {
    try {
      const scope: MemoryScope = {
        orgId: context.orgId,
        teamId: context.teamId ?? null,
        userId: context.userId,
        role: 'member',
      };

      const embedding = await generateEmbedding(context.latestMessage);
      const memories = await searchMemory(scope, context.latestMessage, {
        limit: 10,
        embedding: embedding ?? undefined,
      });

      // Filter out user-layer entries already included above
      const extraMemories = memories.filter(
        (mem) => mem && typeof mem === 'object' && 'layer' in mem && (mem as { layer: string }).layer !== 'user',
      );

      if (extraMemories.length > 0) {
        parts.push('\n## Relevant Context');
        parts.push(
          'The following was retrieved from team/org memory:\n',
        );
        for (const mem of extraMemories) {
          if (mem && typeof mem === 'object' && 'content' in mem) {
            const entry = mem as { layer: string; content: string };
            parts.push(`- [${entry.layer}] ${entry.content}`);
          }
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to search memory for prompt');
    }
  }

  // 3. Installed skills (full content, not just names)
  if (context.userId) {
    try {
      const userSkills = await prisma.userSkill.findMany({
        where: { userId: context.userId },
        include: { skill: { select: { name: true, description: true, content: true } } },
      });

      if (userSkills.length > 0) {
        parts.push('\n## Installed Skills');
        parts.push('Apply these skills when relevant:\n');
        for (const us of userSkills) {
          if (us.skill) {
            parts.push(`### ${us.skill.name}`);
            if (us.skill.description) {
              parts.push(us.skill.description);
            }
            parts.push(us.skill.content);
            parts.push('');
          }
        }
      }
    } catch {
      // Skills table may not exist yet during initial setup
    }
  }

  return parts.join('\n\n');
}
