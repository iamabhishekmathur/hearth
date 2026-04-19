import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { generateEmbedding } from './embedding-service.js';
import { logger } from '../lib/logger.js';
import { emitToOrg } from '../ws/socket-manager.js';

/**
 * Distill principles from established patterns in a domain.
 */
export async function distillPrinciples(orgId: string, domain: string) {
  const patterns = await prisma.decisionPattern.findMany({
    where: { orgId, domain, status: 'established' },
    orderBy: { confidence: 'desc' },
  });

  if (patterns.length < 3) return;

  const patternSummaries = patterns
    .map((p: { name: string; description: string; decisionCount: number }) => `- "${p.name}": ${p.description} (${p.decisionCount} decisions)`)
    .join('\n');

  try {
    const messages = [
      {
        role: 'user' as const,
        content: `Distill high-level organizational principles from these established decision patterns in the "${domain}" domain.

Patterns:
${patternSummaries}

Return a JSON array of principles:
[{
  "title": "Principle title",
  "description": "What this principle means",
  "guideline": "Actionable guidance for following this principle",
  "antiPattern": "What NOT to do (the opposite of this principle)",
  "confidence": 0.0-1.0,
  "patternIds": ["ids of patterns that support this"]
}]

Only distill principles that are clearly supported by multiple patterns. Return [].`,
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
    const principles = JSON.parse(cleaned) as Array<{
      title: string;
      description: string;
      guideline: string;
      antiPattern: string;
      confidence: number;
      patternIds: string[];
    }>;

    for (const p of principles) {
      const existing = await prisma.orgPrinciple.findFirst({
        where: { orgId, domain, title: p.title },
      });

      if (existing) {
        await prisma.orgPrinciple.update({
          where: { id: existing.id },
          data: {
            description: p.description,
            guideline: p.guideline,
            antiPattern: p.antiPattern,
            confidence: p.confidence,
            version: { increment: 1 },
          },
        });
      } else {
        const principle = await prisma.orgPrinciple.create({
          data: {
            orgId,
            domain,
            title: p.title,
            description: p.description,
            guideline: p.guideline,
            antiPattern: p.antiPattern,
            status: 'proposed',
            confidence: p.confidence,
          },
        });

        // Embed
        const embedding = await generateEmbedding(`${p.title}. ${p.description}. ${p.guideline}`);
        if (embedding) {
          const embeddingStr = `[${embedding.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE org_principles SET embedding = $1::vector WHERE id = $2`,
            embeddingStr,
            principle.id,
          );
        }

        // Link evidence
        for (const patternId of p.patternIds ?? []) {
          if (patterns.some((pat: { id: string }) => pat.id === patternId)) {
            await prisma.orgPrincipleEvidence.create({
              data: { principleId: principle.id, patternId },
            }).catch(() => {});
          }
        }

        emitToOrg(orgId, 'decision:principle_updated', {
          principleId: principle.id,
          domain,
          principle: p.title,
          version: 1,
        });
      }
    }

    logger.info({ orgId, domain, principlesFound: principles.length }, 'Principle distillation complete');
  } catch (err) {
    logger.error({ err, orgId, domain }, 'Principle distillation failed');
  }
}

/**
 * Run principle distillation across all domains with enough patterns.
 */
export async function distillAllPrinciples(orgId: string) {
  const domains = await prisma.$queryRawUnsafe<Array<{ domain: string; count: bigint }>>(
    `SELECT domain, COUNT(*) as count FROM decision_patterns
     WHERE org_id = $1 AND status = 'established' AND domain IS NOT NULL
     GROUP BY domain HAVING COUNT(*) >= 3`,
    orgId,
  );

  for (const { domain } of domains) {
    await distillPrinciples(orgId, domain);
  }
}
