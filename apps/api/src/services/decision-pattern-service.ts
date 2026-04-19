import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { generateEmbedding } from './embedding-service.js';
import { logger } from '../lib/logger.js';
import { emitToOrg } from '../ws/socket-manager.js';

/**
 * Extract patterns from clusters of decisions in a domain.
 */
export async function extractPatternsForDomain(orgId: string, domain: string) {
  const decisions = await prisma.decision.findMany({
    where: {
      orgId,
      domain,
      status: 'active',
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  if (decisions.length < 3) return;

  const decisionSummaries = decisions.map((d: { title: string; reasoning: string }) => `- "${d.title}": ${d.reasoning}`).join('\n');

  try {
    const messages = [
      {
        role: 'user' as const,
        content: `Analyze these decisions in the "${domain}" domain and identify recurring patterns.

Decisions:
${decisionSummaries.slice(0, 4000)}

Return a JSON array of patterns:
[{
  "name": "Pattern name",
  "description": "What the pattern is",
  "conditions": "When this pattern applies",
  "typicalOutcome": "What usually happens",
  "decisionIds": ["ids of decisions that match"]
}]

Only include patterns supported by 2+ decisions. Return [] if no clear patterns.`,
      },
    ];

    let result = '';
    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      maxTokens: 1500,
    });
    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
    }

    const cleaned = result.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    const patterns = JSON.parse(cleaned) as Array<{
      name: string;
      description: string;
      conditions: string;
      typicalOutcome: string;
      decisionIds: string[];
    }>;

    for (const p of patterns) {
      const matchCount = p.decisionIds?.length ?? 0;
      const status = matchCount >= 4 ? 'established' : 'emerging';

      // Check if pattern already exists
      const existing = await prisma.decisionPattern.findFirst({
        where: { orgId, domain, name: p.name },
      });

      if (existing) {
        await prisma.decisionPattern.update({
          where: { id: existing.id },
          data: {
            description: p.description,
            conditions: p.conditions,
            typicalOutcome: p.typicalOutcome,
            status,
            decisionCount: matchCount,
          },
        });
      } else {
        const pattern = await prisma.decisionPattern.create({
          data: {
            orgId,
            name: p.name,
            description: p.description,
            domain,
            conditions: p.conditions,
            typicalOutcome: p.typicalOutcome,
            status,
            decisionCount: matchCount,
          },
        });

        // Embed the pattern
        const embedding = await generateEmbedding(`${p.name}. ${p.description}`);
        if (embedding) {
          const embeddingStr = `[${embedding.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE decision_patterns SET embedding = $1::vector WHERE id = $2`,
            embeddingStr,
            pattern.id,
          );
        }

        // Link decisions to pattern
        const validIds = p.decisionIds?.filter((id: string) =>
          decisions.some((d: { id: string }) => d.id === id),
        ) ?? [];
        for (const decisionId of validIds) {
          await prisma.decisionPatternLink.create({
            data: { decisionId, patternId: pattern.id },
          }).catch(() => {});
        }

        emitToOrg(orgId, 'decision:pattern_updated', {
          patternId: pattern.id,
          domain,
          patternName: p.name,
          decisionCount: matchCount,
        });
      }
    }

    logger.info({ orgId, domain, patternsFound: patterns.length }, 'Pattern extraction complete');
  } catch (err) {
    logger.error({ err, orgId, domain }, 'Pattern extraction failed');
  }
}

/**
 * Run pattern extraction across all active domains.
 */
export async function extractAllPatterns(orgId: string) {
  const domains = await prisma.$queryRawUnsafe<Array<{ domain: string; count: bigint }>>(
    `SELECT domain, COUNT(*) as count FROM decisions
     WHERE org_id = $1 AND status = 'active' AND domain IS NOT NULL
       AND created_at >= NOW() - INTERVAL '90 days'
     GROUP BY domain HAVING COUNT(*) >= 3`,
    orgId,
  );

  for (const { domain } of domains) {
    await extractPatternsForDomain(orgId, domain);
  }
}
