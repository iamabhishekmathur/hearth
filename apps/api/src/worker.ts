import { logger } from './lib/logger.js';
import { createSynthesisWorker, scheduleDailySynthesis, enqueueAllUsers, synthesisQueue } from './jobs/synthesis-scheduler.js';
import { createTaskExecutionWorker, taskExecutionQueue } from './services/task-executor.js';
import { createTaskPlanningWorker, taskPlanningQueue } from './services/task-planner.js';
import { createRoutineWorker, syncRoutineSchedules, routineQueue } from './jobs/routine-scheduler.js';
import { createSkillProposalWorker, skillProposalQueue } from './jobs/skill-proposal-job.js';
import { createWorkIntakeWorker, workIntakeQueue } from './jobs/work-intake-scheduler.js';
import { createMeetingPrepWorker, scheduleMeetingPrepScan, meetingPrepQueue } from './jobs/meeting-prep-scheduler.js';
import { createActivityDigestWorker, scheduleActivityDigest, activityDigestQueue } from './jobs/activity-digest-scheduler.js';
import { bootstrapIntegrations } from './mcp/bootstrap.js';
import { loadProviders } from './llm/provider-loader.js';

async function main() {
  logger.info('Hearth worker starting...');

  // Load LLM providers so agent loops can use them
  await loadProviders();

  // Register memory synthesis queue
  const synthesisWorker = createSynthesisWorker();
  logger.info('Registered memory-synthesis worker');

  // Handle the daily trigger job — it enqueues individual user synthesis jobs
  synthesisWorker.on('completed', async (job) => {
    if (job.name === 'daily-synthesis-trigger') {
      await enqueueAllUsers();
    }
  });

  // Schedule the daily synthesis repeatable job
  await scheduleDailySynthesis();

  // Register task execution queue
  const taskWorker = createTaskExecutionWorker();
  logger.info('Registered task-execution worker');

  // Register task planning queue (decomposes tasks into subtasks before execution)
  const taskPlannerWorker = createTaskPlanningWorker();
  logger.info('Registered task-planning worker');

  // Bootstrap MCP integrations from DB so tools are available to agents
  await bootstrapIntegrations();

  // Register routine execution queue
  const routineWorker = createRoutineWorker();
  await syncRoutineSchedules();
  logger.info('Registered routine-execution worker');

  // Register skill proposal queue
  const skillProposalWorker = createSkillProposalWorker();
  logger.info('Registered skill-proposal worker');

  // Register work intake queue
  const workIntakeWorker = createWorkIntakeWorker();
  logger.info('Registered work-intake worker');

  // Register meeting prep queue
  const meetingPrepWorker = createMeetingPrepWorker();
  await scheduleMeetingPrepScan();
  logger.info('Registered meeting-prep worker');

  // Register activity digest queue
  const activityDigestWorker = createActivityDigestWorker();
  await scheduleActivityDigest();
  logger.info('Registered activity-digest worker');

  logger.info('Hearth worker started with 8 queues: memory-synthesis, task-execution, task-planning, routine-execution, skill-proposal, work-intake, meeting-prep, activity-digest');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Worker shutting down...');
    await synthesisWorker.close();
    await taskWorker.close();
    await taskPlannerWorker.close();
    await routineWorker.close();
    await skillProposalWorker.close();
    await workIntakeWorker.close();
    await meetingPrepWorker.close();
    await activityDigestWorker.close();
    await synthesisQueue.close();
    await taskExecutionQueue.close();
    await taskPlanningQueue.close();
    await routineQueue.close();
    await skillProposalQueue.close();
    await workIntakeQueue.close();
    await meetingPrepQueue.close();
    await activityDigestQueue.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
