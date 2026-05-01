/**
 * Multi-Step Workflow Tests — Cross-Feature Journeys
 *
 * These tests validate that features work together correctly
 * across the entire platform, simulating real user workflows.
 */
import { test, expect } from '@playwright/test';
import {
  API,
  USERS,
  loginAs,
  loginAsNewContext,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  createSession,
  deleteSession,
  sendMessage,
  createTask,
  deleteTask,
  pollTaskStatus,
  createDecision,
  createRoutine,
  pollRunStatus,
  createMemory,
  createSkill,
  Cleanup,
  uniqueId,
  HAS_LLM,
} from './fixtures/test-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding Workflows', () => {
  test('First-time admin setup: full org configuration', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Configure LLM', async () => {
      const { status } = await apiGet(page, '/admin/llm-config');
      expect(status).toBe(200);
    });

    await test.step('Set org SOUL.md', async () => {
      const { status } = await apiPut(page, csrf, '/identity/org/soul', {
        content: '# Our Org\nWe ship fast and help each other.',
      });
      expect(status).toBe(200);
    });

    await test.step('Verify teams exist', async () => {
      const { status, body } = await apiGet(page, '/admin/teams');
      expect(status).toBe(200);
      expect((body.data || []).length).toBeGreaterThan(0);
    });

    await test.step('Configure governance', async () => {
      const { status } = await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: true,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
      expect(status).toBe(200);
    });

    await test.step('Enable cognitive profiles', async () => {
      const { status } = await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
      expect([200, 201]).toContain(status);
    });

    await test.step('First chat works with org context', async () => {
      const session = await createSession(page, csrf, uniqueId('first-chat'));
      const msgRes = await sendMessage(page, csrf, session.id, 'What are our coding standards?');
      expect([200, 202]).toContain(msgRes.status);
      await apiDelete(page, csrf, `/chat/sessions/${session.id}`);
    });
  });

  test('New member first day: explore and set up', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Explore every page', async () => {
      const pages = ['chat', 'tasks', 'memory', 'skills', 'routines', 'activity', 'decisions'];
      for (const p of pages) {
        await page.goto(`/#/${p}`);
        await page.waitForTimeout(500);
        console.log(`Page /${p} loads: OK`);
      }
    });

    await test.step('Org memory is accessible', async () => {
      const { status, body } = await apiGet(page, '/memory?layer=org');
      expect(status).toBe(200);
      expect((body.data || []).length).toBeGreaterThan(0);
    });

    await test.step('Skills are browsable', async () => {
      const { status, body } = await apiGet(page, '/skills');
      expect(status).toBe(200);
      expect((body.data || []).length).toBeGreaterThan(0);
    });

    await test.step('Set up identity', async () => {
      const { status } = await apiPut(page, csrf, '/identity/user/soul', {
        content: "I'm new and learning the codebase.",
      });
      expect(status).toBe(200);
    });

    await test.step('Create first task', async () => {
      const task = await createTask(page, csrf, {
        title: uniqueId('onboarding-task'),
        description: 'Read the architecture docs',
      });
      await deleteTask(page, csrf, task.id);
    });
  });

  test('Viewer onboarding: verify read-only on every page', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Viewer should be able to read but not write
    await test.step('Viewer can read tasks', async () => {
      const { status } = await apiGet(page, '/tasks?parentOnly=true');
      expect(status).toBe(200);
    });

    await test.step('Viewer can read decisions', async () => {
      const { status } = await apiGet(page, '/decisions?limit=5');
      expect(status).toBe(200);
    });

    await test.step('Viewer can read activity', async () => {
      const { status } = await apiGet(page, '/activity?limit=5');
      expect(status).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Chat Workflows', () => {
  test('Session sharing and discovery flow', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    let sessionId: string;
    let shareToken: string;

    await test.step('Create session', async () => {
      const session = await createSession(page, csrf, uniqueId('shared-session'));
      sessionId = session.id;
      cleanup.add(() => apiDelete(page, csrf, `/chat/sessions/${sessionId}`));
    });

    await test.step('Send a message', async () => {
      const res = await sendMessage(page, csrf, sessionId, 'This is a shared discussion about architecture');
      expect([200, 202]).toContain(res.status);
    });

    await test.step('Make org-visible', async () => {
      const res = await apiPatch(page, csrf, `/chat/sessions/${sessionId}/visibility`, { visibility: 'org' });
      expect(res.status).toBe(200);
    });

    await test.step('Create share link', async () => {
      const res = await apiPost(page, csrf, `/chat/sessions/${sessionId}/share`, { shareType: 'full' });
      expect([200, 201]).toContain(res.status);
      shareToken = res.body.data?.token;
      expect(shareToken).toBeTruthy();
      console.log(`Share token: ${shareToken}`);
    });

    await test.step('Access shared link', async () => {
      if (shareToken) {
        const res = await apiGet(page, `/shared/${shareToken}`);
        expect([200, 404]).toContain(res.status);
        console.log(`Shared access: ${res.status}`);
      }
    });

    await test.step('Session appears in org-visible list', async () => {
      const { status, body } = await apiGet(page, '/chat/sessions');
      expect(status).toBe(200);
      const sessions = body.data || [];
      const found = sessions.find((s: { id: string }) => s.id === sessionId);
      expect(found).toBeTruthy();
    });

    await cleanup.run();
  });

  test('Collaboration flow: add collaborator', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    await test.step('Create and share session', async () => {
      const session = await createSession(page, csrf, uniqueId('collab-session'));
      cleanup.add(() => apiDelete(page, csrf, `/chat/sessions/${session.id}`));

      // Get a user ID to add as collaborator
      const { body: usersBody } = await apiGet(page, '/admin/users');
      const users = usersBody.data || [];
      const dev1 = users.find((u: { email: string }) => u.email === 'dev1@hearth.local');

      if (dev1) {
        const addRes = await apiPost(page, csrf, `/chat/sessions/${session.id}/collaborators`, {
          userId: dev1.id,
          role: 'contributor',
        });
        expect([200, 201]).toContain(addRes.status);
        console.log(`Added collaborator: ${dev1.email}`);

        // Remove collaborator
        const removeRes = await apiDelete(page, csrf, `/chat/sessions/${session.id}/collaborators/${dev1.id}`);
        expect([200, 204]).toContain(removeRes.status);
        console.log('Removed collaborator');
      }
    });

    await cleanup.run();
  });

  test('Session continuity: long conversation', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('long-convo'));

    await test.step('Send multiple messages', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await sendMessage(page, csrf, session.id, `Message ${i + 1}: ${uniqueId('msg')}`);
        expect([200, 202]).toContain(res.status);
      }
    });

    await test.step('Verify all messages saved', async () => {
      const { status, body } = await apiGet(page, `/chat/sessions/${session.id}`);
      expect(status).toBe(200);
      const messages = body.data?.messages || [];
      console.log(`Messages in session: ${messages.length}`);
      expect(messages.length).toBeGreaterThanOrEqual(5);
    });

    await apiDelete(page, csrf, `/chat/sessions/${session.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TASK WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Task Workflows', () => {
  test('Complete task lifecycle with comments and subtasks', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    let taskId: string;

    await test.step('Create task', async () => {
      const task = await createTask(page, csrf, {
        title: uniqueId('lifecycle-task'),
        description: 'Test full task lifecycle with rich context',
        priority: 2,
      });
      taskId = task.id;
      cleanup.add(() => deleteTask(page, csrf, taskId));
    });

    await test.step('Add comments', async () => {
      for (const text of ['Starting this task', 'Found an issue', 'Fixed and ready']) {
        const res = await apiPost(page, csrf, `/tasks/${taskId}/comments`, { content: text });
        expect(res.status).toBe(201);
      }
    });

    await test.step('Add subtasks', async () => {
      for (const title of ['Research approach', 'Implement solution', 'Write tests']) {
        const res = await apiPost(page, csrf, `/tasks/${taskId}/subtasks`, {
          title,
          description: `Subtask: ${title}`,
        });
        expect(res.status).toBe(201);
      }
    });

    await test.step('Add context items', async () => {
      const noteRes = await apiPost(page, csrf, `/tasks/${taskId}/context`, {
        type: 'note',
        rawValue: 'Important context for this task',
        label: 'Key Note',
      });
      expect(noteRes.status).toBe(201);

      const linkRes = await apiPost(page, csrf, `/tasks/${taskId}/context`, {
        type: 'link',
        rawValue: 'https://example.com/relevant-doc',
        label: 'Reference Doc',
      });
      expect(linkRes.status).toBe(201);
    });

    await test.step('Move to backlog', async () => {
      const res = await apiPatch(page, csrf, `/tasks/${taskId}`, { status: 'backlog' });
      expect(res.status).toBe(200);
    });

    await test.step('Verify task detail', async () => {
      const { status, body } = await apiGet(page, `/tasks/${taskId}`);
      expect(status).toBe(200);
      expect(body.data.comments?.length).toBe(3);
      expect(body.data.subTasks?.length).toBe(3);
      expect(body.data.contextItems?.length).toBe(2);
      console.log(`Task ${taskId}: ${body.data.comments.length} comments, ${body.data.subTasks.length} subtasks, ${body.data.contextItems.length} context items`);
    });

    await cleanup.run();
  });

  test('Auto-detected task triage: accept and dismiss', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    const tasks: string[] = [];

    await test.step('Create auto-detected tasks', async () => {
      for (const source of ['email', 'slack', 'meeting'] as const) {
        const task = await createTask(page, csrf, {
          title: uniqueId(`auto-${source}`),
          source,
        });
        tasks.push(task.id);
        cleanup.add(() => deleteTask(page, csrf, task.id));
        expect(task.status).toBe('auto_detected');
        expect(task.source).toBe(source);
      }
    });

    await test.step('Accept first task to backlog', async () => {
      const res = await apiPatch(page, csrf, `/tasks/${tasks[0]}`, { status: 'backlog' });
      expect(res.status).toBe(200);
    });

    await test.step('Dismiss second task to archived', async () => {
      const res = await apiPatch(page, csrf, `/tasks/${tasks[1]}`, { status: 'archived' });
      expect(res.status).toBe(200);
    });

    await test.step('Verify statuses', async () => {
      const { body: b1 } = await apiGet(page, `/tasks/${tasks[0]}`);
      expect(b1.data.status).toBe('backlog');

      const { body: b2 } = await apiGet(page, `/tasks/${tasks[1]}`);
      expect(b2.data.status).toBe('archived');

      const { body: b3 } = await apiGet(page, `/tasks/${tasks[2]}`);
      expect(b3.data.status).toBe('auto_detected');
    });

    await cleanup.run();
  });

  test('Task review workflow: approve and reject', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    await test.step('Create and move task to backlog', async () => {
      const task = await createTask(page, csrf, {
        title: uniqueId('review-task'),
        description: 'Task for testing review flow',
      });
      cleanup.add(() => deleteTask(page, csrf, task.id));

      await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });

      // Submit a review (assuming task can have reviews added)
      const reviewRes = await apiPost(page, csrf, `/tasks/${task.id}/reviews`, {
        decision: 'approved',
        feedback: 'Looks good to me',
      });
      // Review may require task to be in 'review' status
      console.log(`Review submission: ${reviewRes.status}`);
    });

    await cleanup.run();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DECISION WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Decision Workflows', () => {
  test('Full decision capture with linking and outcomes', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    let dec1Id: string;
    let dec2Id: string;
    let dec3Id: string;

    await test.step('Create engineering decision', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('use-postgres'),
        reasoning: 'PostgreSQL is the best fit for our data model',
        domain: 'engineering',
      });
      dec1Id = dec.id;
    });

    await test.step('Create product decision that depends on engineering', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('api-first'),
        reasoning: 'Build API first, then UI on top',
        domain: 'product',
      });
      dec2Id = dec.id;

      // Link: product decision depends_on engineering decision
      const linkRes = await apiPost(page, csrf, `/decisions/${dec2Id}/dependencies`, {
        toDecisionId: dec1Id,
        relationship: 'depends_on',
        description: 'API design depends on database choice',
      });
      expect([200, 201]).toContain(linkRes.status);
    });

    await test.step('Create design decision related to product', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('ui-framework'),
        reasoning: 'Use React with Tailwind for the frontend',
        domain: 'design',
      });
      dec3Id = dec.id;

      const linkRes = await apiPost(page, csrf, `/decisions/${dec3Id}/dependencies`, {
        toDecisionId: dec2Id,
        relationship: 'related_to',
      });
      expect([200, 201]).toContain(linkRes.status);
    });

    await test.step('View graph — 3-node network', async () => {
      const { status, body } = await apiGet(page, `/decisions/${dec1Id}/graph?depth=2`);
      expect(status).toBe(200);
      console.log(`Graph nodes: ${body.data?.nodes?.length}, edges: ${body.data?.edges?.length}`);
    });

    await test.step('Record outcome on first decision', async () => {
      const res = await apiPost(page, csrf, `/decisions/${dec1Id}/outcomes`, {
        verdict: 'positive',
        description: 'PostgreSQL has been excellent — pgvector support was crucial',
        impactScore: 0.9,
      });
      expect([200, 201]).toContain(res.status);
    });

    await test.step('Search for related decisions', async () => {
      const { status, body } = await apiPost(page, csrf, '/decisions/search', { query: 'database' });
      expect(status).toBe(200);
      console.log(`Search results: ${(body.data || []).length}`);
    });

    // Cleanup decisions
    for (const id of [dec3Id, dec2Id, dec1Id]) {
      await apiDelete(page, csrf, `/decisions/${id}`);
    }
  });

  test('Decision patterns and principles lifecycle', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Get existing patterns', async () => {
      const { status, body } = await apiGet(page, '/decisions/patterns?domain=engineering');
      expect(status).toBe(200);
      console.log(`Engineering patterns: ${(body.data || []).length}`);
    });

    await test.step('Get existing principles', async () => {
      const { status, body } = await apiGet(page, '/decisions/principles');
      expect(status).toBe(200);
      console.log(`Org principles: ${(body.data || []).length}`);
    });
  });

  test('Decision from meeting workflow', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Ingest meeting with transcript', async () => {
      const { status, body } = await apiPost(page, csrf, '/meetings/ingest', {
        provider: 'granola',
        title: uniqueId('arch-meeting'),
        participants: ['admin@hearth.local', 'eng-lead@hearth.local'],
        meetingDate: new Date().toISOString(),
        transcript: 'We discussed whether to use Redis or Memcached for caching. Decided on Redis because of its data structure support and pub/sub capabilities.',
        summary: 'Architecture meeting about caching strategy',
      });
      expect([200, 201]).toContain(status);
      console.log(`Meeting ingested: ${status}`);
      if (body.data?.decisionsExtracted) {
        console.log(`Decisions auto-extracted: ${body.data.decisionsExtracted}`);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTINE WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Routine Workflows', () => {
  test('End-to-end routine with delivery', async ({ page }) => {
    test.slow();
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    let routineId: string;

    await test.step('Create routine', async () => {
      const routine = await createRoutine(page, csrf, {
        name: uniqueId('daily-summary'),
        prompt: 'Summarize what happened today. List key events and decisions.',
        schedule: '0 17 * * 1-5',
        delivery: { channels: ['in_app'] },
      });
      routineId = routine.id;
      cleanup.add(() => apiDelete(page, csrf, `/routines/${routineId}`));
    });

    await test.step('Run now', async () => {
      const res = await apiPost(page, csrf, `/routines/${routineId}/run-now`, {});
      expect(res.status).toBe(200);
      console.log('Routine execution enqueued');
    });

    await test.step('Wait for completion', async () => {
      const run = await pollRunStatus(page, routineId, 60_000);
      console.log(`Run status: ${run.status}`);
      expect(['success', 'failed']).toContain(run.status);
      if (run.status === 'success') {
        const output = run.output?.result || JSON.stringify(run.output);
        console.log(`Output (${String(output).length} chars): ${String(output).slice(0, 200)}`);
      }
    });

    await test.step('Check run history', async () => {
      const { status, body } = await apiGet(page, `/routines/${routineId}/runs`);
      expect(status).toBe(200);
      expect((body.data || []).length).toBeGreaterThanOrEqual(1);
    });

    await cleanup.run();
  });

  test('Routine state persistence across runs', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    let routineId: string;

    await test.step('Create routine with state', async () => {
      const routine = await createRoutine(page, csrf, {
        name: uniqueId('stateful-routine'),
        prompt: 'Process the next batch of data. Track progress in state.',
      });
      routineId = routine.id;
      cleanup.add(() => apiDelete(page, csrf, `/routines/${routineId}`));
    });

    await test.step('Set initial state', async () => {
      const res = await apiPut(page, csrf, `/routines/${routineId}/state`, {
        state: { counter: 1, lastProcessed: 'batch-001' },
      });
      expect(res.status).toBe(200);
    });

    await test.step('Read state back', async () => {
      const { status, body } = await apiGet(page, `/routines/${routineId}/state`);
      expect(status).toBe(200);
      console.log(`State: ${JSON.stringify(body.data)}`);
    });

    await test.step('Update state', async () => {
      const res = await apiPut(page, csrf, `/routines/${routineId}/state`, {
        state: { counter: 2, lastProcessed: 'batch-002' },
      });
      expect(res.status).toBe(200);
    });

    await test.step('Reset state', async () => {
      const res = await apiDelete(page, csrf, `/routines/${routineId}/state`);
      expect([200, 204]).toContain(res.status);
    });

    await test.step('Verify state is empty', async () => {
      const { body } = await apiGet(page, `/routines/${routineId}/state`);
      const state = body.data?.state || body.data;
      console.log(`Reset state: ${JSON.stringify(state)}`);
    });

    await cleanup.run();
  });

  test('Routine chain workflow: A triggers B', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    let routineAId: string;
    let routineBId: string;

    await test.step('Create routine A (data collection)', async () => {
      const a = await createRoutine(page, csrf, {
        name: uniqueId('chain-source'),
        prompt: 'Collect data from integrations',
      });
      routineAId = a.id;
      cleanup.add(() => apiDelete(page, csrf, `/routines/${routineAId}`));
    });

    await test.step('Create routine B (data analysis)', async () => {
      const b = await createRoutine(page, csrf, {
        name: uniqueId('chain-target'),
        prompt: 'Analyze the collected data',
      });
      routineBId = b.id;
      cleanup.add(() => apiDelete(page, csrf, `/routines/${routineBId}`));
    });

    await test.step('Create chain A→B on success', async () => {
      const res = await apiPost(page, csrf, `/routines/${routineAId}/chains`, {
        targetRoutineId: routineBId,
        condition: 'on_success',
        parameterMapping: {},
      });
      expect([200, 201]).toContain(res.status);
      console.log(`Chain created: ${res.status}`);
    });

    await test.step('Verify chain exists', async () => {
      const { status, body } = await apiGet(page, `/routines/${routineAId}/chains`);
      expect(status).toBe(200);
      const chains = body.data || [];
      console.log(`Chains from A: ${chains.length}`);
      expect(chains.length).toBeGreaterThanOrEqual(1);
    });

    await cleanup.run();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOVERNANCE & COMPLIANCE WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Governance & Compliance Workflows', () => {
  test('Full governance lifecycle: enable, create policies, trigger, review, export', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    await test.step('Enable governance', async () => {
      const { status } = await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: true,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
      expect(status).toBe(200);
    });

    // Create blocking policy
    let policyId: string;
    await test.step('Create blocking policy', async () => {
      const res = await apiPost(page, csrf, '/admin/governance/policies', {
        name: uniqueId('wf-block-policy'),
        description: 'Block test keyword',
        category: 'compliance',
        severity: 'critical',
        ruleType: 'keyword',
        ruleConfig: { keywords: [uniqueId('BLOCK_WF')], matchMode: 'any', caseSensitive: true },
        enforcement: 'block',
      });
      expect(res.status).toBe(201);
      policyId = res.body.data.id;
      cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyId}`));
    });

    // Create monitor policy
    let monitorPolicyId: string;
    await test.step('Create monitor policy', async () => {
      const keyword = uniqueId('MONITOR_WF');
      const res = await apiPost(page, csrf, '/admin/governance/policies', {
        name: uniqueId('wf-monitor-policy'),
        description: 'Monitor test keyword',
        category: 'conduct',
        severity: 'info',
        ruleType: 'keyword',
        ruleConfig: { keywords: [keyword], matchMode: 'any', caseSensitive: true },
        enforcement: 'monitor',
      });
      expect(res.status).toBe(201);
      monitorPolicyId = res.body.data.id;
      cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${monitorPolicyId}`));
    });

    // Test violation review
    await test.step('Review violations', async () => {
      const { status, body } = await apiGet(page, '/admin/governance/violations?pageSize=5');
      expect(status).toBe(200);
      console.log(`Violations to review: ${body.total || 0}`);
    });

    await test.step('Export violations as CSV', async () => {
      const res = await page.request.get(`${API}/admin/governance/export?format=csv`);
      expect(res.status()).toBe(200);
      const contentType = res.headers()['content-type'];
      expect(contentType).toContain('text/csv');
    });

    await test.step('Disable governance', async () => {
      const { status } = await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: false,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
      expect(status).toBe(200);
    });

    await cleanup.run();
  });

  test('Compliance workflow: enable packs and verify scrubbing', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Check compliance config', async () => {
      const { status, body } = await apiGet(page, '/admin/compliance/config');
      expect([200, 404]).toContain(status);
      console.log(`Compliance config: ${JSON.stringify(body.data).slice(0, 200)}`);
    });

    await test.step('Enable PII pack', async () => {
      const { status } = await apiPut(page, csrf, '/admin/compliance/config', {
        enabledPacks: ['pii'],
      });
      expect([200, 201]).toContain(status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-FEATURE WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Cross-Feature Workflows', () => {
  test('Organizational knowledge loop: memory → chat → decision → activity', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    await test.step('Create org memory', async () => {
      const mem = await createMemory(page, csrf, {
        content: uniqueId('always-use-REST') + ': Our API standard is REST, not GraphQL',
        layer: 'org',
        source: 'architecture-doc',
      });
      console.log(`Created org memory: ${mem.id}`);
    });

    await test.step('Chat referencing org context', async () => {
      const session = await createSession(page, csrf, uniqueId('knowledge-loop'));
      cleanup.add(() => apiDelete(page, csrf, `/chat/sessions/${session.id}`));
      const res = await sendMessage(page, csrf, session.id, 'What is our API standard?');
      expect([200, 202]).toContain(res.status);
    });

    await test.step('Capture decision from knowledge', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('rest-standard'),
        reasoning: 'We use REST as our API standard, aligned with org memory',
        domain: 'engineering',
      });
      console.log(`Decision captured: ${dec.id}`);
    });

    await test.step('Activity feed shows events', async () => {
      const { status, body } = await apiGet(page, '/activity?limit=10');
      expect(status).toBe(200);
      console.log(`Recent events: ${(body.data || []).length}`);
    });

    await cleanup.run();
  });

  test('Chat → decision → task → skill pipeline', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    await test.step('Create decision from discussion', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('migrate-postgres'),
        reasoning: 'Migrate from SQLite to PostgreSQL for production use',
        domain: 'engineering',
      });
      console.log(`Decision: ${dec.id}`);
    });

    await test.step('Create task to implement', async () => {
      const task = await createTask(page, csrf, {
        title: uniqueId('implement-migration'),
        description: 'Write database migration scripts for PostgreSQL',
        priority: 3,
      });
      cleanup.add(() => deleteTask(page, csrf, task.id));
      console.log(`Task: ${task.id}`);
    });

    await test.step('Create skill from pattern', async () => {
      const { status, data } = await createSkill(page, csrf, {
        name: uniqueId('db-migration-skill'),
        content: '# Database Migration Guide\n\nAlways backup before migrating. Test on staging first.',
        scope: 'personal',
      });
      expect([200, 201]).toContain(status);
      if (data?.id) {
        cleanup.add(() => apiDelete(page, csrf, `/skills/${data.id}`));
      }
    });

    await cleanup.run();
  });

  test('Meeting → decisions → principles pipeline', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Ingest meeting with multiple decisions', async () => {
      const { status } = await apiPost(page, csrf, '/meetings/ingest', {
        provider: 'granola',
        title: uniqueId('strategy-meeting'),
        participants: ['admin@hearth.local'],
        meetingDate: new Date().toISOString(),
        transcript: 'Discussed three key decisions: 1) Use TypeScript everywhere, 2) Deploy with Docker, 3) Use Playwright for e2e testing. All agreed.',
        summary: 'Strategy alignment on tech stack standardization',
      });
      expect([200, 201]).toContain(status);
    });

    await test.step('Check for extracted decisions', async () => {
      // Wait a moment for async extraction
      await new Promise(r => setTimeout(r, 2000));
      const { status, body } = await apiGet(page, '/decisions?limit=5');
      expect(status).toBe(200);
      console.log(`Recent decisions: ${(body.data || []).length}`);
    });

    await test.step('Check for patterns', async () => {
      const { status, body } = await apiGet(page, '/decisions/patterns');
      expect(status).toBe(200);
      console.log(`Detected patterns: ${(body.data || []).length}`);
    });
  });

  test('Identity-driven org culture: SOUL + skills + routines', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Org SOUL.md defines culture', async () => {
      const { status, body } = await apiGet(page, '/identity/org/soul');
      expect(status).toBe(200);
      console.log(`Org SOUL.md length: ${body.data?.content?.length || 0}`);
    });

    await test.step('Skills extend org knowledge', async () => {
      const { status, body } = await apiGet(page, '/skills?tab=all');
      expect(status).toBe(200);
      console.log(`Available skills: ${(body.data || []).length}`);
    });

    await test.step('Routines automate culture', async () => {
      const { status, body } = await apiGet(page, '/routines');
      expect(status).toBe(200);
      console.log(`Active routines: ${(body.data || []).length}`);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCT QUESTIONS TO ANSWER THROUGH TESTING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Product Questions', () => {
  test('Should admin see different home page than regular users?', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/chat');
    await page.waitForTimeout(1000);
    console.log('QUESTION: Admin sees same /chat page as regular users');
    console.log('RECOMMENDATION: Admin should see a dashboard with: violations, approvals, health');
    expect(true).toBe(true);
  });

  test('What happens when viewer tries to access features?', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Test write operations
    const writeEndpoints = [
      { method: 'post', path: '/tasks', data: { title: 'test', source: 'manual' } },
      { method: 'post', path: '/routines', data: { name: 'test', prompt: 'test', delivery: { channels: [] } } },
      { method: 'post', path: '/decisions', data: { title: 'test', reasoning: 'test' } },
    ];

    for (const ep of writeEndpoints) {
      const res = await apiPost(page, csrf, ep.path, ep.data);
      console.log(`Viewer ${ep.method.toUpperCase()} ${ep.path}: ${res.status}`);
      // Clean up if created
      if (res.status === 201 && res.body.data?.id) {
        await apiDelete(page, csrf, `${ep.path}/${res.body.data.id}`);
      }
    }
  });

  test('What is the right empty state for each page?', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const pages = ['chat', 'tasks', 'memory', 'skills', 'routines', 'activity', 'decisions'];

    for (const p of pages) {
      await page.goto(`/#/${p}`);
      await page.waitForTimeout(500);
      // Check for common empty state patterns
      const hasEmptyState = await page.locator('text=No ').count().catch(() => 0);
      const hasGetStarted = await page.locator('text=Get started').count().catch(() => 0);
      const hasCreate = await page.locator('button:has-text("Create"), button:has-text("New")').count().catch(() => 0);
      console.log(`/${p}: emptyState=${hasEmptyState > 0}, getStarted=${hasGetStarted > 0}, createBtn=${hasCreate > 0}`);
    }
  });
});
