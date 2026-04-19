import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { extractContent } from '../services/task-context-extractor.js';
import {
  getContextItem,
  updateExtractionResult,
  generateEmbeddingForItem,
} from '../services/task-context-service.js';
import { emitToTask } from '../ws/socket-manager.js';

const QUEUE_NAME = 'task-context-extraction';
const connection = { url: env.REDIS_URL };

export const taskContextExtractionQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

interface ExtractionJobData {
  itemId: string;
  taskId: string;
}

export function createTaskContextExtractionWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<ExtractionJobData>) => {
      const { itemId, taskId } = job.data;
      logger.info({ itemId, taskId, jobId: job.id }, 'Starting context item extraction');

      const item = await getContextItem(itemId);
      if (!item) {
        logger.warn({ itemId }, 'Context item not found, skipping extraction');
        return;
      }

      // Skip if already completed or skipped
      if (item.extractionStatus === 'completed' || item.extractionStatus === 'skipped') {
        return;
      }

      // Mark as processing
      await updateExtractionResult(itemId, {
        extractionStatus: 'processing',
      });
      emitToTask(taskId, {
        type: 'task:context_item_updated',
        item: { ...item, extractionStatus: 'processing' },
      });

      try {
        const result = await extractContent({
          type: item.type,
          rawValue: item.rawValue,
          mimeType: item.mimeType,
          storagePath: item.storagePath,
          mcpIntegrationId: item.mcpIntegrationId,
          mcpResourceType: item.mcpResourceType,
          mcpResourceId: item.mcpResourceId,
        });

        if (result.error) {
          const updated = await updateExtractionResult(itemId, {
            extractedText: result.extractedText,
            extractedTitle: result.extractedTitle,
            extractionStatus: 'failed',
            extractionError: result.error,
          });
          emitToTask(taskId, { type: 'task:context_item_updated', item: updated });
          return;
        }

        const updated = await updateExtractionResult(itemId, {
          extractedText: result.extractedText,
          extractedTitle: result.extractedTitle,
          extractionStatus: 'completed',
        });
        emitToTask(taskId, { type: 'task:context_item_updated', item: updated });

        // Generate embedding from extracted text
        if (result.extractedText) {
          await generateEmbeddingForItem(itemId, result.extractedText);
        }

        logger.info({ itemId, taskId, type: item.type }, 'Context item extraction completed');
      } catch (err) {
        logger.error({ err, itemId, taskId }, 'Context item extraction failed');
        const updated = await updateExtractionResult(itemId, {
          extractionStatus: 'failed',
          extractionError: err instanceof Error ? err.message : 'Unknown error',
        });
        emitToTask(taskId, { type: 'task:context_item_updated', item: updated });
        throw err;
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Context extraction job failed');
  });

  return worker;
}

export async function enqueueExtraction(itemId: string, taskId: string) {
  await taskContextExtractionQueue.add(
    'extract-context',
    { itemId, taskId },
    { jobId: `ctx-extract-${itemId}-${Date.now()}` },
  );
  logger.info({ itemId, taskId }, 'Context extraction enqueued');
}
