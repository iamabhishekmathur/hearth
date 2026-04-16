import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { generateEmbedding } from './embedding-service.js';

/** Cosine similarity threshold for embedding-based dedup */
const EMBEDDING_SIMILARITY_THRESHOLD = 0.9;

/** Jaccard similarity threshold (fallback when embeddings unavailable) */
const JACCARD_SIMILARITY_THRESHOLD = 0.7;

/** Maximum number of recent tasks to compare against */
const MAX_RECENT_TASKS = 50;

/** Time window (in ms) to look back for duplicates */
const DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Check if a message is a duplicate of an existing non-done task.
 * Uses embedding cosine similarity when available, falls back to Jaccard.
 */
export async function checkDuplicate(userId: string, text: string): Promise<boolean> {
  try {
    const recentTasks = await prisma.task.findMany({
      where: {
        userId,
        status: { notIn: ['done', 'archived'] },
        createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
      },
      select: { id: true, title: true, description: true },
      take: MAX_RECENT_TASKS,
      orderBy: { createdAt: 'desc' },
    });

    if (recentTasks.length === 0) return false;

    // Try embedding-based comparison first
    const embedding = await generateEmbedding(text);
    if (embedding) {
      for (const task of recentTasks) {
        const taskText = [task.title, task.description].filter(Boolean).join(' ');
        const taskEmbedding = await generateEmbedding(taskText);
        if (taskEmbedding) {
          const similarity = cosineSimilarity(embedding, taskEmbedding);
          if (similarity > EMBEDDING_SIMILARITY_THRESHOLD) {
            logger.info(
              { existingTaskId: task.id, similarity: similarity.toFixed(3), method: 'embedding' },
              'Duplicate task detected',
            );
            return true;
          }
        }
      }
      return false;
    }

    // Fallback: Jaccard similarity on word sets
    const normalizedText = normalizeText(text);
    for (const task of recentTasks) {
      const taskText = normalizeText(
        [task.title, task.description].filter(Boolean).join(' '),
      );
      const similarity = computeJaccardSimilarity(normalizedText, taskText);
      if (similarity > JACCARD_SIMILARITY_THRESHOLD) {
        logger.info(
          { existingTaskId: task.id, similarity: similarity.toFixed(3), method: 'jaccard' },
          'Duplicate task detected',
        );
        return true;
      }
    }

    return false;
  } catch (err) {
    logger.error({ err }, 'Deduplication check failed');
    return false; // Don't block task creation on dedup failure
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeJaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
