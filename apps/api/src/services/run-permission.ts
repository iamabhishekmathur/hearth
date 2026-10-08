import { getSessionWriteAccess } from './chat-service.js';
import { getActiveRun } from '../agent/run-registry.js';

/**
 * Who may stop a run (W2). The rule (per the plan's coexistence section):
 * the run's initiator OR a session owner/contributor. A pure viewer may not —
 * they get a 403 and the run continues.
 *
 * - Owner/contributor is checked via `getSessionWriteAccess` (viewers return
 *   null there).
 * - The run initiator is honored even if they aren't a write-access holder
 *   (defensive — in practice the initiator always has write access, since only
 *   owners/contributors can send messages).
 */
export async function canStopRun(
  sessionId: string,
  userId: string,
  runId?: string,
): Promise<boolean> {
  if (runId) {
    const run = getActiveRun(runId);
    if (run && run.initiatorUserId === userId) return true;
  }
  const access = await getSessionWriteAccess(sessionId, userId);
  return access !== null;
}
