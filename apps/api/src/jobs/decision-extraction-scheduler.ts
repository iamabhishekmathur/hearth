import { Queue, Worker } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { detectDecision } from '../services/decision-detector.js';
import { extractDecision } from '../services/decision-extractor.js';
import { createDecision } from '../services/decision-service.js';
import { processMeetingIngestion } from '../services/meeting-ingestion-service.js';
import { emitToUser } from '../ws/socket-manager.js';

const QUEUE_NAME = 'decision-extraction';
const connection = { url: env.REDIS_URL };

export const decisionExtractionQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export function createDecisionExtractionWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case 'chat_session':
          return processSessionExtraction(job.data);
        case 'meeting_ingestion':
          return processMeetingIngestion(job.data.meetingId);
        default:
          logger.warn({ jobName: job.name }, 'Unknown decision extraction job type');
      }
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Decision extraction job failed');
  });

  return worker;
}

async function processSessionExtraction(data: {
  sessionId: string;
  userId: string;
  orgId: string;
}) {
  const { sessionId, userId, orgId } = data;

  // Get recent messages from the session
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  if (messages.length < 3) return;

  // Concatenate conversation for analysis
  const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  // Detect decisions
  const detection = await detectDecision(conversationText);
  if (!detection.isDecision) return;

  // Extract decision details
  const extracted = await extractDecision(conversationText);
  if (!extracted) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { teamId: true, role: true },
  });

  const status = detection.confidence >= 0.85 ? 'active' : 'draft';
  const confidence = detection.confidence >= 0.85 ? 'high' : detection.confidence >= 0.6 ? 'medium' : 'low';

  const decision = await createDecision(
    { orgId, userId, teamId: user?.teamId ?? null, role: user?.role ?? 'member' },
    {
      title: extracted.title,
      reasoning: extracted.reasoning,
      alternatives: extracted.alternatives,
      domain: extracted.domain,
      tags: extracted.relatedTopics,
      source: 'chat',
      sourceRef: { sessionId },
      participants: extracted.stakeholders,
      confidence,
      sessionId,
    },
  );

  // If low confidence, emit suggestion for user review
  if (status === 'draft') {
    emitToUser(userId, 'decision:suggestion', {
      extractedDecision: decision,
      sessionId,
    });
  }
}
