import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const router: ReturnType<typeof Router> = Router();

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for',
  'from', 'have', 'i', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'not', 'of',
  'on', 'or', 'so', 'that', 'the', 'this', 'to', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'will', 'with', 'you', 'your', 'about',
  'how', 'please', 'just', 'thanks', "let's", 'lets', 'me', 'us',
  'do', 'did', 'does', 'has', 'had', 'them', 'they', 'their',
]);

const WINDOW_DAYS = 30;
const MIN_MATCHES = 2; // require at least 2 prior similar prompts (3 incl. current = recurring)
const SIMILARITY_THRESHOLD = 0.4;

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * POST /recurrence/check — given a prompt, find similar prior user prompts
 * authored by the same user in the last 30 days. Returns matches and
 * whether the prompt looks recurring (≥2 matches).
 */
router.post('/check', requireAuth, async (req, res, next) => {
  try {
    const { prompt, excludeMessageId } = req.body as { prompt?: string; excludeMessageId?: string };
    if (!prompt || prompt.trim().length < 10) {
      res.json({ data: { recurring: false, matches: [] } });
      return;
    }

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = await prisma.chatMessage.findMany({
      where: {
        role: 'user',
        createdBy: req.user!.id,
        createdAt: { gte: since },
        ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        sessionId: true,
        content: true,
        createdAt: true,
      },
    });

    const candidateTokens = tokenize(prompt);
    if (candidateTokens.size < 3) {
      res.json({ data: { recurring: false, matches: [] } });
      return;
    }

    const matches: Array<{
      messageId: string;
      sessionId: string;
      contentPreview: string;
      similarity: number;
      createdAt: string;
    }> = [];

    for (const m of recent) {
      const sim = jaccard(candidateTokens, tokenize(m.content));
      if (sim >= SIMILARITY_THRESHOLD) {
        matches.push({
          messageId: m.id,
          sessionId: m.sessionId,
          contentPreview: m.content.slice(0, 120),
          similarity: Number(sim.toFixed(3)),
          createdAt: m.createdAt.toISOString(),
        });
      }
    }

    matches.sort((a, b) => b.similarity - a.similarity);

    res.json({
      data: {
        recurring: matches.length >= MIN_MATCHES,
        matches: matches.slice(0, 5),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
