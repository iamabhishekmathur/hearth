import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import * as proposalService from '../services/skill-proposal-service.js';
import { emitToUser } from '../ws/socket-manager.js';

const QUEUE_NAME = 'skill-proposal';
const connection = { url: env.REDIS_URL };

export const skillProposalQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

interface SkillProposalJobData {
  taskId: string;
  userId: string;
  orgId: string;
}

export function createSkillProposalWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<SkillProposalJobData>) => {
      const { taskId, userId, orgId } = job.data;
      logger.info({ taskId, userId }, 'Evaluating task for skill proposal');

      // Check if task qualifies
      const qualifies = await proposalService.shouldPropose(taskId);
      if (!qualifies) {
        logger.info({ taskId }, 'Task does not qualify for skill proposal (<=3 steps)');
        return { skipped: true };
      }

      // Check if proposal already exists
      const exists = await proposalService.hasProposal(taskId);
      if (exists) {
        logger.info({ taskId }, 'Skill proposal already exists for task');
        return { skipped: true };
      }

      // Generate proposal — throw on failure so BullMQ retries
      const proposal = await proposalService.generateProposal(taskId);
      if (!proposal) {
        throw new Error(`Failed to generate skill proposal for task ${taskId}`);
      }

      // Create draft skill
      const skill = await proposalService.createProposal(taskId, userId, orgId, proposal);
      logger.info({ taskId, skillId: skill.id }, 'Skill proposal created');

      // Notify user
      emitToUser(userId, 'notification', {
        type: 'skill_proposal',
        title: 'New skill proposal',
        body: `A reusable skill "${proposal.name}" has been generated from your completed task.`,
        entityType: 'skill',
        entityId: skill.id,
        taskId,
      });

      return { skillId: skill.id };
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Skill proposal job failed');
  });

  return worker;
}

/**
 * Enqueue a skill proposal evaluation for a completed task.
 */
export async function enqueueSkillProposal(taskId: string, userId: string, orgId: string) {
  await skillProposalQueue.add(
    'evaluate-proposal',
    { taskId, userId, orgId },
    { jobId: `proposal-${taskId}-${Date.now()}` },
  );
  logger.info({ taskId }, 'Skill proposal evaluation enqueued');
}
