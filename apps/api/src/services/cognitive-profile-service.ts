import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { generateEmbedding } from './embedding-service.js';
import { logAudit } from './audit-service.js';
import { logger } from '../lib/logger.js';
import type { Prisma } from '@prisma/client';
import type { CognitiveProfileData, ThoughtPatternCategory } from '@hearth/shared';

// ─── Constants ───────────────────────────────────────────────────────

const PATTERN_SIMILARITY_THRESHOLD = 0.85;
const MAX_ACTIVE_PATTERNS_PER_USER = 500;
const MIN_MESSAGE_TURNS_FOR_EXTRACTION = 3;

// ─── Types ───────────────────────────────────────────────────────────

interface ExtractionInput {
  sessionId: string;
  userId: string;
  orgId: string;
}

interface ExtractedPattern {
  pattern: string;
  category: ThoughtPatternCategory;
  confidence: number;
  excerpt: string;
}

interface ExtractionResult {
  patterns: ExtractedPattern[];
  profileUpdates: {
    expertiseMentioned: Array<{ domain: string; depth: string; evidence: string }>;
    valuesRevealed: string[];
    communicationTraits: Record<string, unknown>;
  };
  contradictions: Array<{ newPattern: string; contradicts: string; reason: string }>;
}

// ─── Extraction Prompt ───────────────────────────────────────────────

const EXTRACTION_PROMPT = `Analyze this conversation to understand how the USER thinks and works.
Extract observations about their reasoning, preferences, and expertise.

Output JSON:
{
  "patterns": [
    {
      "pattern": "When [situation], this person tends to [behavior]",
      "category": "decision|preference|expertise|reaction|value|process",
      "confidence": 0.0-1.0,
      "excerpt": "Direct quote or close paraphrase revealing this"
    }
  ],
  "profileUpdates": {
    "expertiseMentioned": [{ "domain": "...", "depth": "novice|intermediate|expert|authority", "evidence": "..." }],
    "valuesRevealed": ["..."],
    "communicationTraits": {}
  },
  "contradictions": [
    { "newPattern": "...", "contradicts": "...", "reason": "..." }
  ]
}

Rules:
- Only extract patterns with STRONG evidence from the conversation
- Don't infer from single casual remarks — look for repeated behavior or explicit statements
- "excerpt" must be a direct quote or close paraphrase
- Contradictions are valuable — they mean the person's thinking evolved
- Respond with ONLY the JSON object, no markdown fences or explanation.`;

// ─── Org/User Gate ───────────────────────────────────────────────────

/**
 * Checks whether cognitive profiles are enabled at the org level.
 */
export async function isCognitiveEnabledForOrg(orgId: string): Promise<boolean> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const cognitive = (settings.cognitiveProfiles ?? {}) as Record<string, unknown>;
  return cognitive.enabled === true;
}

/**
 * Checks both org-level and user-level gates.
 */
export async function isCognitiveEnabledForUser(orgId: string, userId: string): Promise<boolean> {
  const orgEnabled = await isCognitiveEnabledForOrg(orgId);
  if (!orgEnabled) return false;

  const profile = await prisma.cognitiveProfile.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { enabled: true },
  });

  // If no profile record exists, default to enabled (user can opt out later)
  return profile?.enabled ?? true;
}

// ─── Core: Extract Cognitive Patterns ────────────────────────────────

/**
 * Analyzes a completed session and extracts thought patterns.
 * Gated behind org + user settings. Fire-and-forget.
 */
export async function extractCognitivePatterns(input: ExtractionInput): Promise<void> {
  const { sessionId, userId, orgId } = input;

  try {
    // Gate check (defense-in-depth — caller should also check)
    const enabled = await isCognitiveEnabledForUser(orgId, userId);
    if (!enabled) {
      logger.debug({ sessionId }, 'Cognitive extraction skipped — feature disabled');
      return;
    }

    // Load session messages
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    // Skip trivial sessions
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length < MIN_MESSAGE_TURNS_FOR_EXTRACTION) {
      logger.debug({ sessionId }, 'Cognitive extraction skipped — session too short');
      return;
    }

    // Prepare transcript (budget: last ~30 messages)
    const recentMessages = messages.slice(-30);
    const transcript = recentMessages
      .map(m => `[${m.role}]: ${m.content.slice(0, 2000)}`)
      .join('\n\n');

    // LLM extraction call
    const result = await callExtractionLLM(transcript);
    if (!result || result.patterns.length === 0) {
      logger.debug({ sessionId }, 'No cognitive patterns extracted');
      return;
    }

    // Process each extracted pattern
    let created = 0;
    let reinforced = 0;
    let superseded = 0;

    for (const extracted of result.patterns) {
      const outcome = await processPattern(extracted, sessionId, userId, orgId);
      if (outcome === 'created') created++;
      else if (outcome === 'reinforced') reinforced++;
      else if (outcome === 'superseded') superseded++;
    }

    // Enforce per-user cap
    await enforcePatternCap(userId);

    logger.info(
      { sessionId, userId, created, reinforced, superseded },
      'Cognitive pattern extraction complete',
    );
  } catch (err) {
    logger.error({ err, sessionId }, 'Cognitive pattern extraction failed');
  }
}

// ─── Core: Search Thought Patterns ───────────────────────────────────

/**
 * Semantic search over a user's thought patterns. Returns top-K results.
 */
export async function searchThoughtPatterns(
  subjectUserId: string,
  orgId: string,
  query: string,
  opts?: { limit?: number },
): Promise<Array<{
  id: string;
  pattern: string;
  category: string;
  sourceExcerpt: string;
  confidence: number;
  observationCount: number;
  lastReinforced: Date;
}>> {
  const limit = opts?.limit ?? 10;

  const embedding = await generateEmbedding(query);
  if (!embedding) {
    // Fall back to text search
    return textSearchPatterns(subjectUserId, orgId, query, limit);
  }

  const embeddingStr = `[${embedding.join(',')}]`;

  const results = await prisma.$queryRawUnsafe<Array<{
    id: string;
    pattern: string;
    category: string;
    sourceExcerpt: string;
    confidence: number;
    observationCount: number;
    lastReinforced: Date;
    score: number;
  }>>(`
    SELECT
      id, pattern, category,
      source_excerpt AS "sourceExcerpt",
      confidence,
      observation_count AS "observationCount",
      last_reinforced AS "lastReinforced",
      (
        1 - (embedding <=> $1::vector)
      ) * confidence * (
        CASE WHEN observation_count > 3 THEN 1.2 ELSE 1.0 END
      ) AS score
    FROM thought_patterns
    WHERE embedding IS NOT NULL
      AND superseded_by_id IS NULL
      AND user_id = $2
      AND org_id = $3
    ORDER BY score DESC
    LIMIT $4
  `, embeddingStr, subjectUserId, orgId, limit);

  return results;
}

// ─── Core: Load Cognitive Profile ────────────────────────────────────

/**
 * Loads a user's cognitive profile. Returns null if not found or disabled.
 */
export async function loadCognitiveProfile(
  subjectUserId: string,
  orgId: string,
): Promise<CognitiveProfileData | null> {
  const profile = await prisma.cognitiveProfile.findUnique({
    where: { orgId_userId: { orgId, userId: subjectUserId } },
  });

  if (!profile || !profile.enabled) return null;
  return profile.profile as unknown as CognitiveProfileData;
}

// ─── Core: Profile Rebuild ───────────────────────────────────────────

/**
 * Rebuilds a user's CognitiveProfile by aggregating all active ThoughtPatterns.
 * Called by the daily synthesis job.
 */
export async function rebuildCognitiveProfile(userId: string, orgId: string): Promise<void> {
  const enabled = await isCognitiveEnabledForUser(orgId, userId);
  if (!enabled) return;

  const patterns = await prisma.thoughtPattern.findMany({
    where: {
      userId,
      orgId,
      supersededById: null,
    },
    orderBy: { lastReinforced: 'desc' },
    take: MAX_ACTIVE_PATTERNS_PER_USER,
  });

  if (patterns.length === 0) return;

  // Format patterns for LLM synthesis
  const grouped: Record<string, string[]> = {};
  for (const p of patterns) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(
      `[confidence=${p.confidence.toFixed(2)}, observed=${p.observationCount}x] ${p.pattern}`,
    );
  }

  const patternsText = Object.entries(grouped)
    .map(([cat, items]) => `### ${cat}\n${items.join('\n')}`)
    .join('\n\n');

  const profileData = await callProfileRebuildLLM(patternsText, patterns.length);
  if (!profileData) return;

  await prisma.cognitiveProfile.upsert({
    where: { orgId_userId: { orgId, userId } },
    create: {
      orgId,
      userId,
      profile: profileData as unknown as Prisma.InputJsonValue,
      version: 1,
    },
    update: {
      profile: profileData as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  logger.info({ userId, orgId, patternCount: patterns.length }, 'Rebuilt cognitive profile');
}

// ─── User Opt-Out ────────────────────────────────────────────────────

/**
 * Toggles a user's cognitive profile opt-in/out status.
 */
export async function setCognitiveEnabled(
  userId: string,
  orgId: string,
  enabled: boolean,
): Promise<void> {
  await prisma.cognitiveProfile.upsert({
    where: { orgId_userId: { orgId, userId } },
    create: { orgId, userId, enabled },
    update: { enabled },
  });
}

/**
 * Gets a user's cognitive profile opt-in status.
 */
export async function getCognitiveEnabled(
  userId: string,
  orgId: string,
): Promise<boolean> {
  const profile = await prisma.cognitiveProfile.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { enabled: true },
  });
  return profile?.enabled ?? true;
}

// ─── Internal: Pattern Processing ────────────────────────────────────

async function processPattern(
  extracted: ExtractedPattern,
  sessionId: string,
  userId: string,
  orgId: string,
): Promise<'created' | 'reinforced' | 'superseded' | 'skipped'> {
  // Generate embedding for dedup
  const embedding = await generateEmbedding(extracted.pattern);
  if (!embedding) {
    // Can't dedup without embedding — create directly
    await createPattern(extracted, sessionId, userId, orgId, null);
    return 'created';
  }

  // Search for similar existing patterns
  const embeddingStr = `[${embedding.join(',')}]`;
  const similar = await prisma.$queryRawUnsafe<Array<{
    id: string;
    pattern: string;
    category: string;
    confidence: number;
    observationCount: number;
    similarity: number;
  }>>(`
    SELECT id, pattern, category, confidence, observation_count AS "observationCount",
           (1 - (embedding <=> $1::vector)) AS similarity
    FROM thought_patterns
    WHERE embedding IS NOT NULL
      AND superseded_by_id IS NULL
      AND user_id = $2
    ORDER BY similarity DESC
    LIMIT 1
  `, embeddingStr, userId);

  if (similar.length > 0 && similar[0].similarity >= PATTERN_SIMILARITY_THRESHOLD) {
    const match = similar[0];

    if (match.category === extracted.category) {
      // Same category + high similarity → reinforce
      await prisma.thoughtPattern.update({
        where: { id: match.id },
        data: {
          observationCount: { increment: 1 },
          lastReinforced: new Date(),
          confidence: Math.max(match.confidence, extracted.confidence),
        },
      });
      return 'reinforced';
    } else {
      // Different category with high similarity → potential contradiction, supersede
      const newPattern = await createPattern(extracted, sessionId, userId, orgId, embedding);
      await prisma.thoughtPattern.update({
        where: { id: match.id },
        data: {
          supersededById: newPattern.id,
          supersededReason: `Contradicted by newer observation in category "${extracted.category}"`,
        },
      });
      return 'superseded';
    }
  }

  // No match — create new
  await createPattern(extracted, sessionId, userId, orgId, embedding);
  return 'created';
}

async function createPattern(
  extracted: ExtractedPattern,
  sessionId: string,
  userId: string,
  orgId: string,
  embedding: number[] | null,
): Promise<{ id: string }> {
  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`;
    const result = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      INSERT INTO thought_patterns (
        id, org_id, user_id, pattern, category,
        source_session_id, source_excerpt, confidence,
        observation_count, first_observed, last_reinforced,
        embedding, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6, $7,
        1, NOW(), NOW(),
        $8::vector, NOW()
      )
      RETURNING id
    `,
      orgId, userId, extracted.pattern, extracted.category,
      sessionId, extracted.excerpt, extracted.confidence,
      embeddingStr,
    );
    return { id: result[0].id };
  }

  const record = await prisma.thoughtPattern.create({
    data: {
      orgId,
      userId,
      pattern: extracted.pattern,
      category: extracted.category,
      sourceSessionId: sessionId,
      sourceExcerpt: extracted.excerpt,
      confidence: extracted.confidence,
    },
  });
  return { id: record.id };
}

async function enforcePatternCap(userId: string): Promise<void> {
  const count = await prisma.thoughtPattern.count({
    where: { userId, supersededById: null },
  });

  if (count > MAX_ACTIVE_PATTERNS_PER_USER) {
    const toEvict = await prisma.thoughtPattern.findMany({
      where: { userId, supersededById: null },
      orderBy: [{ confidence: 'asc' }, { lastReinforced: 'asc' }],
      take: count - MAX_ACTIVE_PATTERNS_PER_USER,
      select: { id: true },
    });

    if (toEvict.length > 0) {
      // Self-reference as "evicted" marker (same pattern as experience-service)
      await prisma.thoughtPattern.updateMany({
        where: { id: { in: toEvict.map(e => e.id) } },
        data: {
          supersededById: toEvict[0].id,
          supersededReason: 'Evicted: exceeded per-user pattern cap',
        },
      });
      logger.info({ userId, evicted: toEvict.length }, 'Evicted lowest-confidence thought patterns');
    }
  }
}

// ─── Internal: LLM Calls ────────────────────────────────────────────

async function callExtractionLLM(transcript: string): Promise<ExtractionResult | null> {
  try {
    const messages = [{ role: 'user' as const, content: transcript }];
    let result = '';

    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      systemPrompt: EXTRACTION_PROMPT,
      maxTokens: 2048,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
      if (event.type === 'error') {
        logger.error({ message: event.message }, 'Cognitive extraction LLM error');
        return null;
      }
    }

    return JSON.parse(result.trim()) as ExtractionResult;
  } catch (err) {
    logger.error({ err }, 'Failed to parse cognitive extraction LLM response');
    return null;
  }
}

const PROFILE_REBUILD_PROMPT = `Given these observed thought patterns about a person, synthesize a cognitive profile summary.

Output JSON matching this exact structure:
{
  "communicationStyle": {
    "formality": "casual" | "neutral" | "formal",
    "verbosity": "concise" | "balanced" | "detailed",
    "preferredFormats": ["list of preferred communication formats"]
  },
  "decisionStyle": {
    "approach": "description of how they make decisions",
    "riskTolerance": "conservative" | "moderate" | "aggressive",
    "tendencies": ["tendency 1", "tendency 2"]
  },
  "expertise": [
    { "domain": "...", "depth": "novice|intermediate|expert|authority", "confidence": 0.0-1.0, "evidence": "one-line citation", "lastObserved": "ISO date" }
  ],
  "values": ["value 1", "value 2"],
  "antiPatterns": ["things they explicitly dislike"]
}

Rules:
- Synthesize across ALL patterns, don't just list them
- Weight high-confidence, frequently-observed patterns more heavily
- Be specific about expertise depths — don't inflate
- Values should be action-oriented (what drives their decisions)
- Respond with ONLY the JSON object, no markdown fences.`;

async function callProfileRebuildLLM(
  patternsText: string,
  observationCount: number,
): Promise<CognitiveProfileData | null> {
  try {
    const messages = [{ role: 'user' as const, content: patternsText }];
    let result = '';

    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      systemPrompt: PROFILE_REBUILD_PROMPT,
      maxTokens: 2048,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
      if (event.type === 'error') return null;
    }

    const parsed = JSON.parse(result.trim());
    return {
      ...parsed,
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      observationCount,
    } as CognitiveProfileData;
  } catch (err) {
    logger.error({ err }, 'Failed to parse profile rebuild LLM response');
    return null;
  }
}

// ─── Internal: Text Search Fallback ──────────────────────────────────

async function textSearchPatterns(
  subjectUserId: string,
  orgId: string,
  query: string,
  limit: number,
): Promise<Array<{
  id: string;
  pattern: string;
  category: string;
  sourceExcerpt: string;
  confidence: number;
  observationCount: number;
  lastReinforced: Date;
}>> {
  const results = await prisma.thoughtPattern.findMany({
    where: {
      userId: subjectUserId,
      orgId,
      supersededById: null,
      pattern: { contains: query, mode: 'insensitive' },
    },
    orderBy: [{ confidence: 'desc' }, { lastReinforced: 'desc' }],
    take: limit,
    select: {
      id: true,
      pattern: true,
      category: true,
      sourceExcerpt: true,
      confidence: true,
      observationCount: true,
      lastReinforced: true,
    },
  });

  return results;
}

// ─── Audit Helper ────────────────────────────────────────────────────

/**
 * Logs a cognitive query to the audit trail.
 */
export async function logCognitiveQuery(
  orgId: string,
  queryUserId: string,
  subjectUserId: string,
  sessionId: string,
): Promise<void> {
  await logAudit({
    orgId,
    userId: queryUserId,
    action: 'cognitive_query' as never,
    entityType: 'user' as never,
    entityId: subjectUserId,
    details: {
      subjectUserId,
      sessionId,
      type: 'cognitive_profile_query',
    },
  });
}
