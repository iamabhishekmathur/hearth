import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as routineService from '../services/routine-service.js';
import { enqueueRoutineNow, updateRoutineSchedule } from '../jobs/routine-scheduler.js';
import * as integrationService from '../services/integration-service.js';
import * as webhookService from '../services/webhook-service.js';
import { validateParameterSchema, validateParameterValues, resolveDefaults } from '../services/routine-parameter-service.js';
import { mcpGateway } from '../mcp/gateway.js';
import { prisma } from '../lib/prisma.js';
import type { RoutineParameter, RoutineScope, RoutineStateConfig, ApprovalCheckpointDef } from '@hearth/shared';

/** UUID v4 format check */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a cron expression has the right structure.
 * Accepts standard 5-field cron: minute hour dom month dow
 */
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
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
 * GET /integrations — list connected integrations with their tools
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
 * POST /test-run — execute a prompt once without saving a routine
 */
router.post('/test-run', requireAuth, async (req, res, next) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const tempRoutine = await routineService.createRoutine(req.user!.id, {
      name: `_test_${Date.now()}`,
      description: 'Temporary test run',
      prompt: prompt.trim(),
      schedule: '0 0 31 2 *',
    });

    try {
      await enqueueRoutineNow(tempRoutine.id, req.user!.id);
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
      await routineService.deleteRoutine(tempRoutine.id, req.user!.id).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET / — list routines (Feature 3: scope-aware)
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const scope = req.query.scope as RoutineScope | undefined;
    const routines = await routineService.listRoutines(req.user!.id, {
      scope,
      orgId: req.user!.orgId,
      teamId: req.user!.teamId,
    });
    res.json({ data: routines });
  } catch (err) {
    next(err);
  }
});

// Validate :id param
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
    const {
      name, description, prompt, schedule, context, delivery,
      stateConfig, scope, teamId, parameters, checkpoints,
    } = req.body as {
      name?: string;
      description?: string;
      prompt?: string;
      schedule?: string;
      context?: Record<string, unknown>;
      delivery?: Record<string, unknown>;
      stateConfig?: RoutineStateConfig;
      scope?: RoutineScope;
      teamId?: string;
      parameters?: RoutineParameter[];
      checkpoints?: ApprovalCheckpointDef[];
    };

    if (!name || !prompt) {
      res.status(400).json({ error: 'name and prompt are required' });
      return;
    }

    // Schedule is optional (event-only routines don't need one)
    if (schedule && !isValidCron(schedule)) {
      res.status(400).json({ error: 'Invalid cron schedule. Use 5-field cron format (e.g. "0 9 * * 1-5")' });
      return;
    }

    // Validate parameters schema if provided
    if (parameters && parameters.length > 0) {
      const validation = validateParameterSchema(parameters);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }
    }

    const routine = await routineService.createRoutine(req.user!.id, {
      name,
      description,
      prompt,
      schedule,
      context,
      delivery,
      stateConfig,
      scope,
      teamId: teamId ?? req.user!.teamId ?? undefined,
      orgId: req.user!.orgId ?? undefined,
      parameters,
      checkpoints,
    });

    if (routine.schedule) {
      await updateRoutineSchedule(routine.id);
    }
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
    const {
      name, description, prompt, schedule, context, delivery,
      stateConfig, state, scope, teamId, parameters, checkpoints,
    } = req.body as {
      name?: string;
      description?: string;
      prompt?: string;
      schedule?: string;
      context?: Record<string, unknown>;
      delivery?: Record<string, unknown>;
      stateConfig?: RoutineStateConfig;
      state?: Record<string, unknown>;
      scope?: RoutineScope;
      teamId?: string;
      parameters?: RoutineParameter[];
      checkpoints?: ApprovalCheckpointDef[];
    };

    if (schedule && !isValidCron(schedule)) {
      res.status(400).json({ error: 'Invalid cron schedule. Use 5-field cron format (e.g. "0 9 * * 1-5")' });
      return;
    }

    if (parameters && parameters.length > 0) {
      const validation = validateParameterSchema(parameters);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }
    }

    const routine = await routineService.updateRoutine(req.params.id as string, req.user!.id, {
      name, description, prompt, schedule, context, delivery,
      stateConfig, state, scope, teamId, parameters, checkpoints,
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
 * POST /:id/run-now — trigger immediate execution (Feature 4: with parameters)
 */
router.post('/:id/run-now', requireAuth, async (req, res, next) => {
  try {
    const routine = await routineService.getRoutine(req.params.id as string, req.user!.id);
    if (!routine) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }

    const { parameterValues } = req.body as { parameterValues?: Record<string, unknown> } || {};

    // Validate parameter values if routine has parameters
    const parameters = (routine.parameters as unknown as RoutineParameter[]) ?? [];
    if (parameters.length > 0 && parameterValues) {
      const resolved = resolveDefaults(parameters, parameterValues);
      const validation = validateParameterValues(parameters, resolved);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }
    }

    await enqueueRoutineNow(routine.id, req.user!.id, { parameterValues });
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

// ── Feature 1: State endpoints ──

/**
 * GET /:id/state — get routine state
 */
router.get('/:id/state', requireAuth, async (req, res, next) => {
  try {
    const state = await routineService.getState(req.params.id as string);
    res.json({ data: state });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /:id/state — update routine state
 */
router.put('/:id/state', requireAuth, async (req, res, next) => {
  try {
    const state = req.body as Record<string, unknown>;
    await routineService.updateState(req.params.id as string, state);
    res.json({ data: state });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /:id/state — reset routine state
 */
router.delete('/:id/state', requireAuth, async (req, res, next) => {
  try {
    await routineService.resetState(req.params.id as string);
    res.json({ data: {} });
  } catch (err) {
    next(err);
  }
});

// ── Feature 2: Trigger CRUD ──

/**
 * GET /:id/triggers — list triggers for a routine
 */
router.get('/:id/triggers', requireAuth, async (req, res, next) => {
  try {
    const triggers = await prisma.routineTrigger.findMany({
      where: { routineId: req.params.id as string },
      include: { webhookEndpoint: { select: { id: true, provider: true, urlToken: true } } },
    });
    res.json({ data: triggers });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:id/triggers — create a trigger for a routine
 */
router.post('/:id/triggers', requireAuth, async (req, res, next) => {
  try {
    const { webhookEndpointId, eventType, filters, parameterMapping } = req.body as {
      webhookEndpointId?: string;
      eventType?: string;
      filters?: Record<string, unknown>;
      parameterMapping?: Record<string, string>;
    };

    if (!webhookEndpointId || !eventType) {
      res.status(400).json({ error: 'webhookEndpointId and eventType are required' });
      return;
    }

    const trigger = await prisma.routineTrigger.create({
      data: {
        routineId: req.params.id as string,
        webhookEndpointId,
        eventType,
        filters: (filters ?? {}) as never,
        parameterMapping: (parameterMapping ?? {}) as never,
      },
    });
    res.status(201).json({ data: trigger });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /:id/triggers/:triggerId — delete a trigger
 */
router.delete('/:id/triggers/:triggerId', requireAuth, async (req, res, next) => {
  try {
    await prisma.routineTrigger.delete({ where: { id: req.params.triggerId as string } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── Feature 2: Webhook endpoint CRUD ──

/**
 * GET /webhook-endpoints — list webhook endpoints for the org
 */
router.get('/webhook-endpoints', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }
    const endpoints = await webhookService.listWebhookEndpoints(orgId);
    res.json({ data: endpoints });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhook-endpoints — create a webhook endpoint
 */
router.post('/webhook-endpoints', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization context required' });
      return;
    }

    const { provider, integrationId } = req.body as {
      provider?: string;
      integrationId?: string;
    };

    if (!provider) {
      res.status(400).json({ error: 'provider is required' });
      return;
    }

    const result = await webhookService.createWebhookEndpoint(orgId, { provider, integrationId });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /webhook-endpoints/:endpointId — delete a webhook endpoint
 */
router.delete('/webhook-endpoints/:endpointId', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization context required' });
      return;
    }

    const result = await webhookService.deleteWebhookEndpoint(req.params.endpointId as string, orgId);
    if (!result) {
      res.status(404).json({ error: 'Webhook endpoint not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
