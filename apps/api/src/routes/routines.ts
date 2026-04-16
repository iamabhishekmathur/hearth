import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as routineService from '../services/routine-service.js';
import { enqueueRoutineNow, updateRoutineSchedule } from '../jobs/routine-scheduler.js';
import * as integrationService from '../services/integration-service.js';
import { mcpGateway } from '../mcp/gateway.js';

/** UUID v4 format check */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a cron expression has the right structure.
 * Accepts standard 5-field cron: minute hour dom month dow
 */
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  // Each field: number, *, ranges, lists, steps
  const fieldRe = /^(\*|[0-9]{1,2})([,-/][0-9*]{1,3})*$/;
  return parts.every((p) => fieldRe.test(p));
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: 'Slack',
  github: 'GitHub',
  notion: 'Notion',
  jira: 'Jira',
  gmail: 'Gmail',
  gdrive: 'Google Drive',
  gcalendar: 'Google Calendar',
};

// Resource-like parameters that represent locations within an integration
const RESOURCE_PARAM_NAMES = new Set([
  'channel', 'repo', 'owner', 'project', 'database_id',
  'page_id', 'board', 'label', 'calendarId',
]);

function extractResourceParams(tool: { name: string; inputSchema?: Record<string, unknown> }) {
  const params: Array<{ name: string; description: string }> = [];
  const schema = tool.inputSchema as { properties?: Record<string, { description?: string }> } | undefined;
  if (!schema?.properties) return params;

  for (const [key, val] of Object.entries(schema.properties)) {
    if (RESOURCE_PARAM_NAMES.has(key)) {
      params.push({ name: key, description: val.description ?? key });
    }
  }
  return params;
}

const router: ReturnType<typeof Router> = Router();

/**
 * GET /integrations — list connected integrations with their tools (for @ mentions in prompt)
 * Non-admin endpoint: returns provider names, tools, and resource hints — no credentials.
 */
router.get('/integrations', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }

    const integrations = await integrationService.listIntegrations(orgId);
    const active = integrations.filter((i) => i.enabled && i.status === 'active');

    const result = await Promise.all(
      active.map(async (integ) => {
        // Try live tools from gateway; fall back to static definitions for the provider
        let tools = await mcpGateway.listTools(integ.id);
        if (tools.length === 0) {
          tools = mcpGateway.getStaticTools(integ.provider);
        }
        return {
          id: integ.id,
          provider: integ.provider,
          label: PROVIDER_LABELS[integ.provider] ?? integ.provider,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            // Extract resource parameters from input schema (channels, repos, etc.)
            resourceParams: extractResourceParams(t),
          })),
        };
      }),
    );

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /test-run — execute a prompt once without saving a routine, and return the output
 */
router.post('/test-run', requireAuth, async (req, res, next) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    // Create a temporary routine, run it, return output, then delete
    const tempRoutine = await routineService.createRoutine(req.user!.id, {
      name: `_test_${Date.now()}`,
      description: 'Temporary test run',
      prompt: prompt.trim(),
      schedule: '0 0 31 2 *', // Feb 31 — will never fire
    });

    try {
      await enqueueRoutineNow(tempRoutine.id, req.user!.id);
      // Poll for completion (max 30 seconds)
      const startTime = Date.now();
      let run = null;
      while (Date.now() - startTime < 30000) {
        const result = await routineService.listRuns(tempRoutine.id, req.user!.id, 1);
        if (result && result.data.length > 0) {
          const latest = result.data[0];
          if (latest.status !== 'running') {
            run = latest;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      res.json({
        data: run
          ? { status: run.status, output: run.output, error: run.error, durationMs: run.durationMs }
          : { status: 'timeout', output: null, error: 'Test run did not complete within 30 seconds' },
      });
    } finally {
      // Clean up temp routine
      await routineService.deleteRoutine(tempRoutine.id, req.user!.id).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET / — list current user's routines
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const routines = await routineService.listRoutines(req.user!.id);
    res.json({ data: routines });
  } catch (err) {
    next(err);
  }
});

// Validate :id param on all parameterized routes
router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid ID format' });
    return;
  }
  next();
});

/**
 * GET /:id — get routine detail
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const routine = await routineService.getRoutine(req.params.id as string, req.user!.id);
    if (!routine) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    res.json({ data: routine });
  } catch (err) {
    next(err);
  }
});

/**
 * POST / — create a routine
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description, prompt, schedule, context, delivery } = req.body as {
      name?: string;
      description?: string;
      prompt?: string;
      schedule?: string;
      context?: Record<string, unknown>;
      delivery?: Record<string, unknown>;
    };

    if (!name || !prompt || !schedule) {
      res.status(400).json({ error: 'name, prompt, and schedule are required' });
      return;
    }

    if (!isValidCron(schedule)) {
      res.status(400).json({ error: 'Invalid cron schedule. Use 5-field cron format (e.g. "0 9 * * 1-5")' });
      return;
    }

    const routine = await routineService.createRoutine(req.user!.id, {
      name,
      description,
      prompt,
      schedule,
      context,
      delivery,
    });

    await updateRoutineSchedule(routine.id);
    res.status(201).json({ data: routine });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /:id — update a routine
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { name, description, prompt, schedule, context, delivery } = req.body as {
      name?: string;
      description?: string;
      prompt?: string;
      schedule?: string;
      context?: Record<string, unknown>;
      delivery?: Record<string, unknown>;
    };

    if (schedule && !isValidCron(schedule)) {
      res.status(400).json({ error: 'Invalid cron schedule. Use 5-field cron format (e.g. "0 9 * * 1-5")' });
      return;
    }

    const routine = await routineService.updateRoutine(req.params.id as string, req.user!.id, {
      name,
      description,
      prompt,
      schedule,
      context,
      delivery,
    });

    if (!routine) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }

    await updateRoutineSchedule(routine.id);
    res.json({ data: routine });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /:id — delete a routine
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const routine = await routineService.deleteRoutine(req.params.id as string, req.user!.id);
    if (!routine) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    await updateRoutineSchedule(routine.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:id/toggle — enable/disable a routine
 */
router.post('/:id/toggle', requireAuth, async (req, res, next) => {
  try {
    const routine = await routineService.toggleRoutine(req.params.id as string, req.user!.id);
    if (!routine) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    await updateRoutineSchedule(routine.id);
    res.json({ data: routine });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:id/run-now — trigger immediate execution
 */
router.post('/:id/run-now', requireAuth, async (req, res, next) => {
  try {
    const routine = await routineService.getRoutine(req.params.id as string, req.user!.id);
    if (!routine) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    await enqueueRoutineNow(routine.id, req.user!.id);
    res.json({ message: 'Routine execution enqueued' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:id/runs — list run history
 */
router.get('/:id/runs', requireAuth, async (req, res, next) => {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const result = await routineService.listRuns(req.params.id as string, req.user!.id, page);
    if (!result) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
