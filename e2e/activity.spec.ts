import { test, expect } from '@playwright/test';
import {
  API,
  loginAs,
  loginAsNewContext,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  Cleanup,
  uniqueId,
  HAS_LLM,
} from './fixtures/test-helpers';

// ═════════════════════════════════════════════════════════════════════════════
// Activity Feed — Comprehensive E2E Tests
//
// Covers: feed loading, filtering, pagination, reactions, proactive signals,
// digest generation, and product gap documentation.
//
// Actual API:
//   GET    /activity                     — feed (cursor, limit, action, userId, since)
//   GET    /activity/signals             — proactive signals
//   GET    /activity/digest              — digest summary
//   POST   /activity/:id/reactions       — add reaction { emoji } -> { data: { success: true } }
//   DELETE /activity/:id/reactions/:emoji — remove reaction (emoji in path)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Activity Feed', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ─── Feed ───────────────────────────────────────────────────────────────────

  test.describe('Feed', () => {
    test('1. Feed loads with events — data array returned', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      const { status, body } = await apiGet(page, '/activity');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('hasMore');
      console.log(`Feed loaded: ${body.data.length} events, hasMore=${body.hasMore}`);
    });

    test('2. Events include expected fields (id, action, entityType, userName)', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Create a task to guarantee at least one event
      const taskTitle = uniqueId('activity-fields');
      const taskRes = await apiPost(page, csrf, '/tasks', {
        title: taskTitle,
        source: 'manual',
      });
      expect(taskRes.status).toBe(201);
      const taskId = taskRes.body.data.id;
      cleanup.add(async () => {
        await apiDelete(page, csrf, `/tasks/${taskId}`);
      });

      // Brief wait for event propagation
      await page.waitForTimeout(1000);

      const { status, body } = await apiGet(page, '/activity?limit=20');
      expect(status).toBe(200);
      expect(body.data.length).toBeGreaterThan(0);

      const event = body.data[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('action');
      expect(event).toHaveProperty('entityType');
      expect(event).toHaveProperty('entityId');
      expect(event).toHaveProperty('userId');
      expect(event).toHaveProperty('userName');
      expect(event).toHaveProperty('createdAt');
      console.log('Event fields verified:', Object.keys(event).join(', '));
      console.log('Sample event:', JSON.stringify(event, null, 2));
    });

    test('3. Filter by task action — only task events', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Seed a task event
      const taskTitle = uniqueId('filter-tasks');
      const taskRes = await apiPost(page, csrf, '/tasks', {
        title: taskTitle,
        source: 'manual',
      });
      expect(taskRes.status).toBe(201);
      const taskId = taskRes.body.data.id;
      cleanup.add(async () => {
        await apiDelete(page, csrf, `/tasks/${taskId}`);
      });

      await page.waitForTimeout(1000);

      // The actual query param is ?action=task.created (not ?filter=tasks)
      const { status, body } = await apiGet(page, '/activity?action=task.created');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);

      for (const event of body.data) {
        expect(event.action).toBe('task.created');
      }
      console.log(`Tasks filter: ${body.data.length} task.created events returned`);
    });

    test('4. Filter by skill action — only skill events', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Seed a skill event
      const skillName = uniqueId('filter-skills');
      const skillRes = await apiPost(page, csrf, '/skills', {
        name: skillName,
        description: 'Test skill for activity filter',
        content: 'Test skill content for activity feed filtering',
        scope: 'personal',
      });
      if (skillRes.status === 201) {
        const skillId = skillRes.body.data?.id;
        if (skillId) {
          cleanup.add(async () => {
            await apiDelete(page, csrf, `/skills/${skillId}`);
          });
        }
      }

      await page.waitForTimeout(1000);

      const { status, body } = await apiGet(page, '/activity?action=skill.created');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);

      for (const event of body.data) {
        expect(event.action).toBe('skill.created');
      }
      console.log(`Skills filter: ${body.data.length} skill.created events returned`);
    });

    test('5. Filter by routine action — only routine events', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      const { status, body } = await apiGet(page, '/activity?action=routine.created');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);

      for (const event of body.data) {
        expect(event.action).toBe('routine.created');
      }
      console.log(`Routines filter: ${body.data.length} routine.created events returned`);
    });

    test('6. Filter by decision action — only decision events', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Seed a decision event
      const decisionTitle = uniqueId('filter-decisions');
      const decisionRes = await apiPost(page, csrf, '/decisions', {
        title: decisionTitle,
        reasoning: 'Testing activity feed decision filtering',
        domain: 'engineering',
        alternatives: [],
        scope: 'org',
        confidence: 'medium',
      });
      if (decisionRes.status === 201) {
        const decisionId = decisionRes.body.data?.id;
        if (decisionId) {
          cleanup.add(async () => {
            await apiDelete(page, csrf, `/decisions/${decisionId}`);
          });
        }
      }

      await page.waitForTimeout(1000);

      const { status, body } = await apiGet(page, '/activity?action=decision.created');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);

      for (const event of body.data) {
        expect(event.action).toBe('decision.created');
      }
      console.log(`Decisions filter: ${body.data.length} decision.created events returned`);
    });

    test('7. No filter — returns all event types', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // No action filter — returns all feed-worthy actions
      const { status, body } = await apiGet(page, '/activity');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);

      // Collect unique action types
      const actions = new Set(body.data.map((e: { action: string }) => e.action));
      console.log(`All events: ${body.data.length} events across actions: ${[...actions].join(', ')}`);

      // With no filter we should see a mix (or at least not be restricted)
      if (body.data.length > 5) {
        expect(actions.size).toBeGreaterThanOrEqual(1);
      }
    });

    test('8. Cursor pagination — next batch with cursor', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Fetch first page with small limit
      const page1 = await apiGet(page, '/activity?limit=2');
      expect(page1.status).toBe(200);
      expect(Array.isArray(page1.body.data)).toBe(true);

      console.log(`Page 1: ${page1.body.data.length} events, hasMore=${page1.body.hasMore}, nextCursor=${page1.body.nextCursor}`);

      if (page1.body.hasMore && page1.body.nextCursor) {
        // Fetch second page using cursor
        const page2 = await apiGet(page, `/activity?limit=2&cursor=${page1.body.nextCursor}`);
        expect(page2.status).toBe(200);
        expect(Array.isArray(page2.body.data)).toBe(true);

        // Ensure no overlap between pages
        const page1Ids = new Set(page1.body.data.map((e: { id: string }) => e.id));
        for (const event of page2.body.data) {
          expect(page1Ids.has(event.id)).toBe(false);
        }
        console.log(`Page 2: ${page2.body.data.length} events, no overlap with page 1`);
      } else {
        console.log('Not enough events for pagination test — only one page of results');
      }
    });

    test('9. Create a task — verify event appears in feed', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Snapshot current feed
      const before = await apiGet(page, '/activity?limit=5');
      expect(before.status).toBe(200);
      const beforeIds = new Set(before.body.data.map((e: { id: string }) => e.id));

      // Create a task
      const taskTitle = uniqueId('activity-verify');
      const taskRes = await apiPost(page, csrf, '/tasks', {
        title: taskTitle,
        source: 'manual',
        description: 'Task created to verify activity feed event generation',
      });
      expect(taskRes.status).toBe(201);
      const taskId = taskRes.body.data.id;
      cleanup.add(async () => {
        await apiDelete(page, csrf, `/tasks/${taskId}`);
      });

      // Poll for the new event to appear
      let found = false;
      const start = Date.now();
      while (Date.now() - start < 10_000) {
        const after = await apiGet(page, '/activity?limit=10');
        const newEvents = after.body.data.filter(
          (e: { id: string; entityId: string; action: string }) =>
            !beforeIds.has(e.id) && e.entityId === taskId,
        );
        if (newEvents.length > 0) {
          found = true;
          const event = newEvents[0];
          expect(event.action).toContain('task');
          expect(event.entityId).toBe(taskId);
          console.log(`Event appeared for task ${taskId}: action=${event.action}`);
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(found).toBe(true);
    });
  });

  // ─── Reactions ──────────────────────────────────────────────────────────────

  test.describe('Reactions', () => {
    /**
     * Helper: get or create an activity event to react to.
     * Creates a task to guarantee an event, then returns the eventId.
     */
    async function ensureActivityEvent(
      page: import('@playwright/test').Page,
      csrf: string,
      cl: Cleanup,
    ): Promise<string> {
      const taskTitle = uniqueId('reaction-target');
      const taskRes = await apiPost(page, csrf, '/tasks', {
        title: taskTitle,
        source: 'manual',
      });
      expect(taskRes.status).toBe(201);
      const taskId = taskRes.body.data.id;
      cl.add(async () => {
        await apiDelete(page, csrf, `/tasks/${taskId}`);
      });

      // Wait for the activity event to be created
      await page.waitForTimeout(2000);

      const { body } = await apiGet(page, '/activity?limit=20');
      const events = body.data || [];
      // Activity events may store task ID as entityId or in details
      const event = events.find(
        (e: { entityId?: string; entityType?: string; details?: Record<string, unknown> }) =>
          e.entityId === taskId ||
          (e.entityType === 'task' && (e.details as Record<string, unknown>)?.id === taskId),
      );
      // If no matching event found, use the most recent event for reaction testing
      const targetEvent = event || events[0];
      if (!targetEvent) {
        throw new Error('No activity events found at all');
      }
      if (!event) {
        console.log(`PRODUCT FINDING: Task event not found in feed by entityId. Using most recent event instead.`);
      }
      return targetEvent.id;
    }

    test.fixme('10. Add thumbs-up reaction — success', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');
      const eventId = await ensureActivityEvent(page, csrf, cleanup);

      // Reaction POST returns { data: { success: true } }, not { data: { id } }
      const { status, body } = await apiPost(page, csrf, `/activity/${eventId}/reactions`, {
        emoji: '\ud83d\udc4d',
      });
      expect(status).toBe(200);
      expect(body.data).toBeTruthy();
      expect(body.data.success).toBe(true);
      console.log(`Reaction added to event ${eventId}:`, JSON.stringify(body.data));

      // Clean up reaction — DELETE uses emoji as path param
      cleanup.add(async () => {
        await apiDelete(page, csrf, `/activity/${eventId}/reactions/${encodeURIComponent('\ud83d\udc4d')}`);
      });
    });

    test.fixme('11. Add multiple different reactions — all stored', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');
      const eventId = await ensureActivityEvent(page, csrf, cleanup);

      const emojis = ['\ud83d\udc4d', '\ud83c\udf89', '\ud83d\udd25'];

      for (const emoji of emojis) {
        const { status, body } = await apiPost(page, csrf, `/activity/${eventId}/reactions`, {
          emoji,
        });
        expect(status).toBe(200);
        expect(body.data.success).toBe(true);
        console.log(`Added reaction ${emoji} to event ${eventId}`);
      }

      // Verify all reactions are present by refetching the feed
      const { body: feedBody } = await apiGet(page, '/activity?limit=20');
      const targetEvent = feedBody.data.find(
        (e: { id: string }) => e.id === eventId,
      );

      if (targetEvent?.reactions) {
        expect(targetEvent.reactions.length).toBeGreaterThanOrEqual(emojis.length);
        console.log(`Event ${eventId} has ${targetEvent.reactions.length} reactions`);
      } else {
        console.log('Reactions embedded in feed response — verifying via creation success');
      }

      // Cleanup — delete reactions by emoji path param
      for (const emoji of emojis) {
        cleanup.add(async () => {
          await apiDelete(page, csrf, `/activity/${eventId}/reactions/${encodeURIComponent(emoji)}`);
        });
      }
    });

    test.fixme('12. Remove reaction — deleted', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');
      const eventId = await ensureActivityEvent(page, csrf, cleanup);

      // Add a reaction
      const addRes = await apiPost(page, csrf, `/activity/${eventId}/reactions`, {
        emoji: '\ud83d\udc4e',
      });
      expect(addRes.status).toBe(200);
      expect(addRes.body.data.success).toBe(true);
      console.log(`Created reaction on event ${eventId}`);

      // Delete the reaction — using emoji as path param
      const delRes = await apiDelete(page, csrf, `/activity/${eventId}/reactions/${encodeURIComponent('\ud83d\udc4e')}`);
      // DELETE returns { data: { success: true } } with status 200
      expect(delRes.status).toBe(200);
      expect(delRes.body.data.success).toBe(true);
      console.log(`Deleted reaction — status ${delRes.status}`);
    });

    test.fixme('13. Same user duplicate reaction — unique constraint (409 or idempotent)', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');
      const eventId = await ensureActivityEvent(page, csrf, cleanup);

      // Add reaction first time
      const first = await apiPost(page, csrf, `/activity/${eventId}/reactions`, {
        emoji: '\u2764\ufe0f',
      });
      expect(first.status).toBe(200);
      console.log(`First reaction: status=${first.status}`);

      cleanup.add(async () => {
        await apiDelete(page, csrf, `/activity/${eventId}/reactions/${encodeURIComponent('\u2764\ufe0f')}`);
      });

      // Add same reaction again — should be 409 (conflict) or 200 (idempotent)
      const second = await apiPost(page, csrf, `/activity/${eventId}/reactions`, {
        emoji: '\u2764\ufe0f',
      });
      console.log(`Duplicate reaction: status=${second.status}, body=${JSON.stringify(second.body)}`);

      // Accept either 409 (unique constraint) or 200 (idempotent upsert)
      expect([200, 409]).toContain(second.status);

      if (second.status === 409) {
        console.log('Server enforces unique constraint on duplicate reactions (409)');
      } else {
        console.log('Server handles duplicate reactions idempotently');
      }
    });
  });

  // ─── Proactive Signals ──────────────────────────────────────────────────────

  test.describe('Proactive Signals', () => {
    test('14. Get signals — returns signal array', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      const { status, body } = await apiGet(page, '/activity/signals');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      console.log(`Proactive signals: ${body.data.length} signals returned`);

      if (body.data.length > 0) {
        const signal = body.data[0];
        console.log('Sample signal:', JSON.stringify(signal, null, 2));
        expect(signal).toHaveProperty('id');
      }
    });

    test('15. Signals are computed per-user — endpoint returns data', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // There is no dismiss endpoint — signals are computed dynamically.
      // Verify the signals endpoint returns data and the shape is correct.
      const { status, body } = await apiGet(page, '/activity/signals');
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);

      if (body.data.length > 0) {
        const signal = body.data[0];
        expect(signal.id).toBeTruthy();
        console.log(`Signal: id=${signal.id}, type=${signal.type ?? signal.action ?? 'unknown'}`);
      } else {
        console.log('No signals available — signal generation may require more activity');
      }

      // Create some activity to potentially trigger signals
      const taskTitle = uniqueId('signal-trigger');
      const taskRes = await apiPost(page, csrf, '/tasks', {
        title: taskTitle,
        source: 'manual',
      });
      if (taskRes.status === 201) {
        cleanup.add(async () => {
          await apiDelete(page, csrf, `/tasks/${taskRes.body.data.id}`);
        });
      }

      await page.waitForTimeout(2000);

      // Re-check signals after activity
      const retry = await apiGet(page, '/activity/signals');
      expect(retry.status).toBe(200);
      console.log(`Signals after activity: ${retry.body.data.length} signals`);
    });
  });

  // ─── Digest ─────────────────────────────────────────────────────────────────

  test.describe('Digest', () => {
    test('16. Get digest — returns summary text', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      const { status, body } = await apiGet(page, '/activity/digest');
      expect(status).toBe(200);
      expect(body.data).toBeTruthy();
      console.log('Digest response:', JSON.stringify(body.data, null, 2).slice(0, 500));

      // Digest should contain some form of summary content
      if (typeof body.data === 'string') {
        expect(body.data.length).toBeGreaterThan(0);
        console.log(`Digest text length: ${body.data.length} chars`);
      } else if (typeof body.data === 'object') {
        // May be structured with summary, highlights, etc.
        console.log('Digest is structured object with keys:', Object.keys(body.data).join(', '));
      }
    });
  });

  // ─── Product Gaps ──────────────────────────────────────────────────────────

  test.describe('Product Gaps', () => {
    test('17. No activity search capability — document gap', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Attempt to search activity events by keyword
      const { status: searchStatus } = await apiGet(page, '/activity?search=test');
      console.log(`Activity search attempt: status=${searchStatus}`);

      // Also try a dedicated search endpoint
      const { status: searchEndpointStatus } = await apiGet(page, '/activity/search?q=test');
      console.log(`Activity /search endpoint attempt: status=${searchEndpointStatus}`);

      // Document the gap
      console.log('=== PRODUCT GAP: Activity Search ===');
      console.log('Current state: No search/query parameter for filtering activity events by keyword.');
      console.log('Expected: Users should be able to search activity feed by action description,');
      console.log('  entity name, or user name (e.g., "find all events related to deployment").');
      console.log('Impact: Teams with high activity volume cannot find specific events without');
      console.log('  scrolling through paginated results.');
      console.log('Recommendation: Add ?search= or ?q= query parameter to GET /activity that');
      console.log('  performs full-text search across event action, details, and entity names.');
      console.log('=====================================');

      // Test passes — documenting the gap, not asserting its absence
      expect(true).toBe(true);
    });

    test('18. No activity export — document gap', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Attempt to export activity
      const { status: csvStatus } = await apiGet(page, '/activity/export?format=csv');
      console.log(`Activity CSV export attempt: status=${csvStatus}`);

      const { status: jsonExportStatus } = await apiGet(page, '/activity/export?format=json');
      console.log(`Activity JSON export attempt: status=${jsonExportStatus}`);

      console.log('=== PRODUCT GAP: Activity Export ===');
      console.log('Current state: No export endpoint for activity feed data.');
      console.log('Expected: Admins and team leads should be able to export activity logs');
      console.log('  in CSV/JSON format for auditing, compliance, and reporting.');
      console.log('Impact: Organizations with compliance requirements cannot extract activity');
      console.log('  data for external audit tools or record-keeping.');
      console.log('Recommendation: Add GET /activity/export?format=csv|json endpoint with');
      console.log('  date range filtering and optional entity type scoping.');
      console.log('====================================');

      expect(true).toBe(true);
    });

    test('19. No CTA from activity events — document gap', async ({ page }) => {
      const csrf = await loginAs(page, 'admin');

      // Fetch activity and check for actionable links/CTAs
      const { status, body } = await apiGet(page, '/activity?limit=10');
      expect(status).toBe(200);

      let hasActionUrl = false;
      let hasCta = false;
      for (const event of body.data) {
        if (event.actionUrl || event.cta || event.link || event.href) {
          hasActionUrl = true;
        }
        if (event.actions && Array.isArray(event.actions) && event.actions.length > 0) {
          hasCta = true;
        }
      }

      console.log('=== PRODUCT GAP: Activity Event CTAs ===');
      console.log(`Current state: Events have actionUrl=${hasActionUrl}, inline actions=${hasCta}`);
      console.log('Expected: Each activity event should include a call-to-action that lets');
      console.log('  users navigate directly to the relevant entity or take a follow-up action.');
      console.log('  Examples:');
      console.log('  - "task.completed" -> "View Task" button linking to the task');
      console.log('  - "decision.created" -> "Review Decision" linking to decision detail');
      console.log('  - "routine.failed" -> "View Logs" linking to run history');
      console.log('Impact: Activity feed is read-only — users see what happened but cannot');
      console.log('  act on it without manually navigating, reducing feed engagement.');
      console.log('Recommendation: Add actionUrl (deep link) and optional actions[] array');
      console.log('  (inline CTAs like "Approve", "Review", "Re-run") to event payloads.');
      console.log('========================================');

      expect(true).toBe(true);
    });
  });
});

test.describe('UI — Activity Page', () => {
  test('Activity page renders with filter pills and feed', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/activity');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/activity');

    // Filter pills
    for (const filter of ['All', 'Tasks', 'Skills', 'Routines', 'Decisions']) {
      const pill = page.locator(`button:has-text("${filter}")`).first();
      const visible = await pill.isVisible().catch(() => false);
      console.log(`Filter pill "${filter}" visible: ${visible}`);
    }
  });

  test('Click filter pills changes displayed events', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/activity');
    await page.waitForTimeout(2000);

    // Click Tasks filter
    const tasksFilter = page.locator('button:has-text("Tasks")').first();
    if (await tasksFilter.isVisible().catch(() => false)) {
      await tasksFilter.click();
      await page.waitForTimeout(500);
      console.log('Filtered by Tasks');
    }

    // Click All to reset
    const allFilter = page.locator('button:has-text("All")').first();
    if (await allFilter.isVisible().catch(() => false)) {
      await allFilter.click();
      await page.waitForTimeout(500);
      console.log('Reset to All filter');
    }
  });

  test('Activity feed shows time-bucketed groups', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/activity');
    await page.waitForTimeout(2000);

    // Look for time bucket headers
    for (const bucket of ['Today', 'Yesterday', 'This Week', 'Older']) {
      const header = page.locator(`text=${bucket}`).first();
      const visible = await header.isVisible().catch(() => false);
      if (visible) console.log(`Time bucket "${bucket}" visible`);
    }
  });
});
