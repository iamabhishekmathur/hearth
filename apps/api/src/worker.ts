import { logger } from './lib/logger.js';
import { createSynthesisWorker, scheduleDailySynthesis, enqueueAllUsers, synthesisQueue } from './jobs/synthesis-scheduler.js';
import { createTaskExecutionWorker, taskExecutionQueue } from './services/task-executor.js';
import { createTaskPlanningWorker, taskPlanningQueue } from './services/task-planner.js';
import { createRoutineWorker, syncRoutineSchedules, routineQueue } from './jobs/routine-scheduler.js';
import { createSkillProposalWorker, skillProposalQueue } from './jobs/skill-proposal-job.js';
import { createWorkIntakeWorker, workIntakeQueue } from './jobs/work-intake-scheduler.js';
import { createMeetingPrepWorker, scheduleMeetingPrepScan, meetingPrepQueue } from './jobs/meeting-prep-scheduler.js';
import { createActivityDigestWorker, scheduleActivityDigest, activityDigestQueue } from './jobs/activity-digest-scheduler.js';
import { createHealthCheckerWorker, scheduleHealthChecks, healthCheckQueue } from './jobs/routine-health-checker.js';
import { createCognitiveExtractionWorker, scheduleCognitiveProfileRebuild, cognitiveExtractionQueue } from './jobs/cognitive-extraction-scheduler.js';
import { createTaskContextExtractionWorker, taskContextExtractionQueue } from './jobs/task-context-extraction-job.js';
import { createDecisionExtractionWorker, decisionExtractionQueue } from './jobs/decision-extraction-scheduler.js';
import { createDecisionStalenessWorker, scheduleDecisionStalenessCheck, decisionStalenessQueue } from './jobs/decision-staleness-scheduler.js';
import { createDecisionPatternWorker, schedulePatternSynthesis, decisionPatternQueue } from './jobs/decision-pattern-scheduler.js';
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

  // Register routine health checker queue (Feature 8)
  const healthCheckerWorker = createHealthCheckerWorker();
  await scheduleHealthChecks();
  logger.info('Registered routine-health-check worker');

  // Register cognitive extraction queue (Digital Co-Worker)
  const cognitiveExtractionWorker = createCognitiveExtractionWorker();
  await scheduleCognitiveProfileRebuild();
  logger.info('Registered cognitive-extraction worker');

  // Register task context extraction queue
  const taskContextExtractionWorker = createTaskContextExtractionWorker();
  logger.info('Registered task-context-extraction worker');

  // Register decision extraction queue (Context Graph)
  const decisionExtractionWorker = createDecisionExtractionWorker();
  logger.info('Registered decision-extraction worker');

  // Register decision staleness checker
  const decisionStalenessWorker = createDecisionStalenessWorker();
  await scheduleDecisionStalenessCheck();
  logger.info('Registered decision-staleness worker');

  // Register decision pattern synthesis
  const decisionPatternWorker = createDecisionPatternWorker();
  await schedulePatternSynthesis();
  logger.info('Registered decision-pattern-synthesis worker');

  logger.info('Hearth worker started with 14 queues: memory-synthesis, task-execution, task-planning, routine-execution, skill-proposal, work-intake, meeting-prep, activity-digest, routine-health-check, cognitive-extraction, task-context-extraction, decision-extraction, decision-staleness, decision-pattern-synthesis');

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
    await healthCheckerWorker.close();
    await cognitiveExtractionWorker.close();
    await taskContextExtractionWorker.close();
    await synthesisQueue.close();
    await taskExecutionQueue.close();
    await taskPlanningQueue.close();
    await routineQueue.close();
    await skillProposalQueue.close();
    await workIntakeQueue.close();
    await meetingPrepQueue.close();
    await activityDigestQueue.close();
    await healthCheckQueue.close();
    await cognitiveExtractionQueue.close();
    await taskContextExtractionQueue.close();
    await decisionExtractionWorker.close();
    await decisionStalenessWorker.close();
    await decisionPatternWorker.close();
    await decisionExtractionQueue.close();
    await decisionStalenessQueue.close();
    await decisionPatternQueue.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
