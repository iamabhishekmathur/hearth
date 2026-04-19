import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { generateEmbedding } from './embedding-service.js';
import { logger } from '../lib/logger.js';
import type { ExperienceOutcome, Prisma } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────

interface ReflectionInput {
  sessionId: string;
  userId: string;
  orgId: string;
  durationMs?: number;
  iterationCount?: number;
  tokenCount?: number;
  toolFailures?: string[];
}

interface ReflectionResult {
  taskSummary: string;
  approach: string;
  outcome: 'success' | 'partial' | 'failure';
  learnings: string[];
  toolsUsed: string[];
  tags: string[];
  quality: number;
  shouldProposeSkill: boolean;
}

export interface ExperienceRecord {
  id: string;
  taskSummary: string;
  approach: string;
  outcome: ExperienceOutcome;
  learnings: string[];
  toolsUsed: string[];
  tags: string[];
  quality: number | null;
  createdAt: Date;
}

// ─── Constants ───────────────────────────────────────────────────────

const MIN_TOOL_CALLS_FOR_REFLECTION = 2;
const MIN_MESSAGE_TURNS_FOR_REFLECTION = 3;
const SKILL_PROPOSAL_QUALITY_THRESHOLD = 0.8;
const SKILL_PROPOSAL_MIN_TOOL_CALLS = 3;
const MAX_SKILL_PROPOSALS_PER_DAY = 5;
const EXPERIENCE_SIMILARITY_THRESHOLD = 0.85;
const MAX_ACTIVE_EXPERIENCES_PER_USER = 200;
const EXPERIENCE_SEARCH_LIMIT = 3;
const EXPERIENCE_TTL_DAYS = 90;

// ─── Reflection Prompt ───────────────────────────────────────────────

const REFLECTION_PROMPT = `You are a post-session analyst. Analyze this conversation between a user and an AI assistant.

Extract the following as a JSON object:
{
  "taskSummary": "1-2 sentence summary of what the user wanted",
  "approach": "Brief description of how the assistant approached the task",
  "outcome": "success" | "partial" | "failure",
  "learnings": ["bullet-point takeaway 1", "bullet-point takeaway 2", ...],
  "toolsUsed": ["tool_name_1", "tool_name_2", ...],
  "tags": ["semantic_tag_1", "semantic_tag_2", ...],
  "quality": 0.0-1.0 confidence rating of how well the task was handled,
  "shouldProposeSkill": true/false — whether this approach is novel, reusable, and high-quality enough to save as a skill
}

Rules:
- Only include action-verified learnings (things that actually happened in the conversation, not hypotheticals)
- Rate quality based on: did the task complete? were there errors? how many retries?
- Tags should be semantic categories useful for future retrieval (e.g., "data-analysis", "code-review", "jira-integration")
- Set shouldProposeSkill=true only if: quality >= 0.8, the approach involved 3+ tool calls, and the pattern would genuinely help on similar future tasks
- Keep learnings concise but specific — avoid generic advice

Respond with ONLY the JSON object, no markdown fences or explanation.`;

// ─── Core: Post-Session Reflection ───────────────────────────────────

/**
 * Analyzes a completed session and produces an experience record.
 * Fire-and-forget — never blocks the user.
 */
export async function reflectOnSession(input: ReflectionInput): Promise<void> {
  const { sessionId, userId, orgId, durationMs, iterationCount, tokenCount, toolFailures } = input;

  try {
    // Load session messages
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, metadata: true },
    });

    // Skip trivial sessions
    const userMessages = messages.filter(m => m.role === 'user');
    const toolMessages = messages.filter(m => m.role === 'tool');
    if (toolMessages.length < MIN_TOOL_CALLS_FOR_REFLECTION && userMessages.length < MIN_MESSAGE_TURNS_FOR_REFLECTION) {
      logger.debug({ sessionId }, 'Skipping reflection — session too short');
      return;
    }

    // Prepare conversation transcript for the LLM (budget: last ~30 messages)
    const recentMessages = messages.slice(-30);
    const transcript = recentMessages
      .map(m => `[${m.role}]: ${m.content.slice(0, 2000)}`)
      .join('\n\n');

    // Add failure context if available
    let failureContext = '';
    if (toolFailures && toolFailures.length > 0) {
      failureContext = `\n\nNOTE: The following tool calls failed during this session: ${toolFailures.join(', ')}. Reflect on these failures in your learnings.`;
    }

    // Make reflection LLM call
    const reflection = await callReflectionLLM(transcript + failureContext);
    if (!reflection) {
      logger.warn({ sessionId }, 'Reflection LLM call returned no result');
      return;
    }

    // Generate embedding from task summary + learnings
    const embeddingText = `${reflection.taskSummary}. ${reflection.learnings.join('. ')}`;
    const embedding = await generateEmbedding(embeddingText);

    // Deduplicate before saving
    const existingExp = await findSimilarExperience(userId, orgId, embedding);

    if (existingExp) {
      if (existingExp.outcome === reflection.outcome) {
        // Same outcome → merge learnings into existing record
        await mergeExperience(existingExp.id, reflection);
        logger.info({ sessionId, mergedInto: existingExp.id }, 'Merged experience into existing');
      } else {
        // Different outcome → supersede the older one
        await createExperience({
          orgId, userId, sessionId, reflection, embedding,
          durationMs, iterationCount, tokenCount,
          supersededById: undefined,
        });
        await prisma.agentExperience.update({
          where: { id: existingExp.id },
          data: { supersededById: existingExp.id },
        });
        logger.info({ sessionId, superseded: existingExp.id }, 'Created experience superseding older one');
      }
    } else {
      const experience = await createExperience({
        orgId, userId, sessionId, reflection, embedding,
        durationMs, iterationCount, tokenCount,
      });

      // Maybe propose a skill
      if (reflection.shouldProposeSkill && reflection.quality >= SKILL_PROPOSAL_QUALITY_THRESHOLD) {
        await maybeProposeSKill(experience.id, reflection, userId, orgId, sessionId).catch(err => {
          logger.warn({ err, sessionId }, 'Skill proposal failed');
        });
      }

      logger.info({ sessionId, experienceId: experience.id }, 'Created experience record');
    }

    // Enforce per-user cap
    await enforceExperienceCap(userId);
  } catch (err) {
    logger.error({ err, sessionId }, 'Post-session reflection failed');
  }
}

// ─── Core: Experience Search ─────────────────────────────────────────

/**
 * Searches for relevant past experiences using semantic similarity.
 * Returns personal experiences + high-quality org-wide ones.
 */
export async function searchExperiences(
  userId: string,
  orgId: string,
  query: string,
  opts?: { limit?: number },
): Promise<ExperienceRecord[]> {
  const limit = opts?.limit ?? EXPERIENCE_SEARCH_LIMIT;

  const embedding = await generateEmbedding(query);
  if (!embedding) {
    // Fall back to text search on taskSummary
    return textSearchExperiences(userId, orgId, query, limit);
  }

  const embeddingStr = `[${embedding.join(',')}]`;
  const recencyCutoff = new Date(Date.now() - EXPERIENCE_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Vector similarity search with recency decay and quality weighting
  const results = await prisma.$queryRawUnsafe<ExperienceRecord[]>(`
    SELECT
      id, task_summary AS "taskSummary", approach, outcome, learnings,
      tools_used AS "toolsUsed", tags, quality, created_at AS "createdAt",
      (
        1 - (embedding <=> $1::vector)
      ) * COALESCE(quality, 0.5) * (
        CASE WHEN created_at < $4 THEN 0.5 ELSE 1.0 END
      ) AS score
    FROM agent_experiences
    WHERE embedding IS NOT NULL
      AND superseded_by_id IS NULL
      AND (
        (user_id = $2)
        OR (org_id = $3 AND quality >= 0.8)
      )
    ORDER BY score DESC
    LIMIT $5
  `, embeddingStr, userId, orgId, recencyCutoff, limit);

  return results;
}

// ─── Skill Proposal ──────────────────────────────────────────────────

const SKILL_PROPOSAL_PROMPT = `Convert this successful AI assistant approach into a reusable skill document.

The skill should be in markdown format with:
1. A "## When to use" section describing when this skill applies
2. A "## Approach" section with step-by-step instructions for the AI
3. A "## Tools" section listing which tools to use
4. If the approach involved writing code that was verified to work, include it in a "## Script" section

Keep it concise and actionable — this will be injected into an AI assistant's prompt.`;

async function maybeProposeSKill(
  experienceId: string,
  reflection: ReflectionResult,
  userId: string,
  orgId: string,
  sessionId: string,
): Promise<void> {
  // Rate limit: max proposals per day
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const proposalsToday = await prisma.skill.count({
    where: {
      authorId: userId,
      source: 'auto_generated',
      createdAt: { gte: todayStart },
    },
  });
  if (proposalsToday >= MAX_SKILL_PROPOSALS_PER_DAY) {
    logger.debug({ userId }, 'Skill proposal rate limit reached');
    return;
  }

  // Check for duplicate skills
  const embeddingText = `${reflection.taskSummary}. ${reflection.learnings.join('. ')}`;
  const embedding = await generateEmbedding(embeddingText);
  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`;
    // Check for existing skills with similar name+description
    const existingSkills = await prisma.skill.findMany({
      where: { orgId, status: { in: ['draft', 'published'] } },
      select: { name: true, description: true },
      take: 50,
    });
    // Simple text overlap check — embedding on skills would require another column
    const summaryLower = reflection.taskSummary.toLowerCase();
    const isDuplicate = existingSkills.some(s =>
      s.name.toLowerCase().includes(summaryLower.slice(0, 30)) ||
      (s.description && s.description.toLowerCase().includes(summaryLower.slice(0, 30))),
    );
    if (isDuplicate) {
      logger.debug({ userId }, 'Skill proposal skipped — similar skill exists');
      return;
    }
  }

  // Generate skill content via LLM
  const approachSummary = `Task: ${reflection.taskSummary}\nApproach: ${reflection.approach}\nTools used: ${reflection.toolsUsed.join(', ')}\nLearnings:\n${reflection.learnings.map(l => `- ${l}`).join('\n')}`;

  const skillContent = await callSkillProposalLLM(approachSummary);
  if (!skillContent) return;

  // Derive a skill name from the task summary
  const skillName = reflection.taskSummary
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .slice(0, 5)
    .join(' ')
    .trim() || 'Auto-generated skill';

  await prisma.skill.create({
    data: {
      orgId,
      name: skillName,
      description: reflection.taskSummary,
      content: skillContent,
      authorId: userId,
      scope: 'personal',
      status: 'draft',
      source: 'auto_generated',
      sourceExperienceId: experienceId,
      createdVia: 'reflection',
    } as never,
  });

  logger.info({ userId, skillName }, 'Proposed auto-generated skill');
}

/**
 * Creates a draft skill directly from agent tool call (propose_skill tool).
 */
export async function createProposedSkill(
  userId: string,
  orgId: string,
  name: string,
  description: string,
  content: string,
): Promise<{ id: string; name: string }> {
  // Rate limit
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const proposalsToday = await prisma.skill.count({
    where: {
      authorId: userId,
      source: 'auto_generated',
      createdAt: { gte: todayStart },
    },
  });
  if (proposalsToday >= MAX_SKILL_PROPOSALS_PER_DAY) {
    throw new Error('Daily skill proposal limit reached (5/day). Try again tomorrow.');
  }

  // Deduplicate by name
  const existing = await prisma.skill.findFirst({
    where: { orgId, name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    throw new Error(`A skill named "${name}" already exists.`);
  }

  const skill = await prisma.skill.create({
    data: {
      orgId,
      name,
      description,
      content,
      authorId: userId,
      scope: 'personal',
      status: 'draft',
      source: 'auto_generated',
      createdVia: 'agent',
    } as never,
  });

  return { id: skill.id, name: skill.name };
}

// ─── Internal Helpers ────────────────────────────────────────────────

async function callReflectionLLM(transcript: string): Promise<ReflectionResult | null> {
  try {
    const messages = [{ role: 'user' as const, content: transcript }];
    let result = '';

    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      systemPrompt: REFLECTION_PROMPT,
      maxTokens: 1024,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
      if (event.type === 'error') {
        logger.error({ message: event.message }, 'Reflection LLM error');
        return null;
      }
    }

    return JSON.parse(result.trim()) as ReflectionResult;
  } catch (err) {
    logger.error({ err }, 'Failed to parse reflection LLM response');
    return null;
  }
}

async function callSkillProposalLLM(approachSummary: string): Promise<string | null> {
  try {
    const messages = [{ role: 'user' as const, content: approachSummary }];
    let result = '';

    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      systemPrompt: SKILL_PROPOSAL_PROMPT,
      maxTokens: 2048,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
      if (event.type === 'error') return null;
    }

    return result.trim() || null;
  } catch {
    return null;
  }
}

async function findSimilarExperience(
  userId: string,
  orgId: string,
  embedding: number[] | null,
): Promise<{ id: string; outcome: ExperienceOutcome } | null> {
  if (!embedding) return null;

  const embeddingStr = `[${embedding.join(',')}]`;
  const results = await prisma.$queryRawUnsafe<Array<{ id: string; outcome: ExperienceOutcome; similarity: number }>>(`
    SELECT id, outcome, (1 - (embedding <=> $1::vector)) AS similarity
    FROM agent_experiences
    WHERE embedding IS NOT NULL
      AND superseded_by_id IS NULL
      AND user_id = $2
    ORDER BY similarity DESC
    LIMIT 1
  `, embeddingStr, userId);

  if (results.length > 0 && results[0].similarity >= EXPERIENCE_SIMILARITY_THRESHOLD) {
    return { id: results[0].id, outcome: results[0].outcome };
  }

  return null;
}

async function mergeExperience(existingId: string, reflection: ReflectionResult): Promise<void> {
  const existing = await prisma.agentExperience.findUnique({
    where: { id: existingId },
    select: { learnings: true, toolsUsed: true, tags: true },
  });
  if (!existing) return;

  // Union learnings, tools, tags (deduplicated)
  const mergedLearnings = [...new Set([...existing.learnings, ...reflection.learnings])];
  const mergedTools = [...new Set([...existing.toolsUsed, ...reflection.toolsUsed])];
  const mergedTags = [...new Set([...existing.tags, ...reflection.tags])];

  await prisma.agentExperience.update({
    where: { id: existingId },
    data: {
      learnings: mergedLearnings,
      toolsUsed: mergedTools,
      tags: mergedTags,
      quality: Math.max(reflection.quality, 0),
    },
  });
}

async function createExperience(params: {
  orgId: string;
  userId: string;
  sessionId: string;
  reflection: ReflectionResult;
  embedding: number[] | null;
  durationMs?: number;
  iterationCount?: number;
  tokenCount?: number;
  supersededById?: string;
}): Promise<{ id: string }> {
  const { orgId, userId, sessionId, reflection, embedding, durationMs, iterationCount, tokenCount } = params;

  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`;
    const result = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      INSERT INTO agent_experiences (
        id, org_id, user_id, session_id,
        task_summary, approach, outcome,
        learnings, tools_used, tags,
        embedding, token_count, iteration_count, duration_ms, quality,
        created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3,
        $4, $5, $6::\"ExperienceOutcome\",
        $7::text[], $8::text[], $9::text[],
        $10::vector, $11, $12, $13, $14,
        NOW()
      )
      RETURNING id
    `,
      orgId, userId, sessionId,
      reflection.taskSummary, reflection.approach, reflection.outcome,
      reflection.learnings, reflection.toolsUsed, reflection.tags,
      embeddingStr, tokenCount ?? null, iterationCount ?? null, durationMs ?? null, reflection.quality,
    );
    return { id: result[0].id };
  }

  // Without embedding (fallback)
  const record = await prisma.agentExperience.create({
    data: {
      orgId, userId, sessionId,
      taskSummary: reflection.taskSummary,
      approach: reflection.approach,
      outcome: reflection.outcome as ExperienceOutcome,
      learnings: reflection.learnings,
      toolsUsed: reflection.toolsUsed,
      tags: reflection.tags,
      tokenCount: tokenCount ?? null,
      iterationCount: iterationCount ?? null,
      durationMs: durationMs ?? null,
      quality: reflection.quality,
    },
  });
  return { id: record.id };
}

async function textSearchExperiences(
  userId: string,
  orgId: string,
  query: string,
  limit: number,
): Promise<ExperienceRecord[]> {
  const results = await prisma.agentExperience.findMany({
    where: {
      supersededById: null,
      OR: [
        { userId, taskSummary: { contains: query, mode: 'insensitive' } },
        { orgId, quality: { gte: 0.8 }, taskSummary: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      taskSummary: true,
      approach: true,
      outcome: true,
      learnings: true,
      toolsUsed: true,
      tags: true,
      quality: true,
      createdAt: true,
    },
  });

  return results;
}

async function enforceExperienceCap(userId: string): Promise<void> {
  const count = await prisma.agentExperience.count({
    where: { userId, supersededById: null },
  });

  if (count > MAX_ACTIVE_EXPERIENCES_PER_USER) {
    // Find lowest-quality experiences to mark as superseded (soft delete)
    const toEvict = await prisma.agentExperience.findMany({
      where: { userId, supersededById: null },
      orderBy: [{ quality: 'asc' }, { createdAt: 'asc' }],
      take: count - MAX_ACTIVE_EXPERIENCES_PER_USER,
      select: { id: true },
    });

    if (toEvict.length > 0) {
      await prisma.agentExperience.updateMany({
        where: { id: { in: toEvict.map(e => e.id) } },
        data: { supersededById: toEvict[0].id }, // self-reference as "evicted" marker
      });
      logger.info({ userId, evicted: toEvict.length }, 'Evicted lowest-quality experiences');
    }
  }
}
