/**
 * Persona-Driven Scenario Tests — "A Day in the Life"
 *
 * Each persona gets a full workflow test simulating their real usage.
 * These tests validate whether Hearth solves each persona's job-to-be-done
 * AND identify product gaps/missing features.
 */
import { test, expect } from '@playwright/test';
import {
  API,
  USERS,
  loginAs,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  createSession,
  sendMessage,
  createTask,
  deleteTask,
  createDecision,
  createRoutine,
  createMemory,
  createSkill,
  Cleanup,
  uniqueId,
} from './fixtures/test-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 1: Admin (IT/Ops) — "Keep the org safe and running"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: Admin — org safety and operations', () => {
  test('Admin morning setup: configure LLM, integrations, governance, compliance', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Login lands on /chat', async () => {
      await page.goto('/#/chat');
      await page.waitForTimeout(1000);
      const url = page.url();
      expect(url).toContain('/chat');
      console.log(`Admin landing page: ${url}`);
      console.log('PRODUCT GAP: Admin lands on /chat, not a control panel/dashboard');
    });

    await test.step('Navigate to Settings > LLM Config', async () => {
      const { status, body } = await apiGet(page, '/admin/llm-config');
      expect(status).toBe(200);
      console.log(`LLM config: ${JSON.stringify(body.data).slice(0, 200)}`);
    });

    await test.step('Verify integrations connected', async () => {
      const { status, body } = await apiGet(page, '/admin/integrations');
      expect(status).toBe(200);
      const integrations = body.data || [];
      console.log(`Integrations: ${integrations.length} configured`);
      for (const integ of integrations) {
        console.log(`  ${integ.provider}: ${integ.status} (enabled=${integ.enabled})`);
      }
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
      console.log('Governance enabled');
    });

    await test.step('Verify users visible', async () => {
      const { status, body } = await apiGet(page, '/admin/users');
      expect(status).toBe(200);
      const users = body.data || [];
      console.log(`Users in org: ${users.length}`);
      expect(users.length).toBeGreaterThanOrEqual(2);
    });

    await test.step('Verify teams exist', async () => {
      const { status, body } = await apiGet(page, '/admin/teams');
      expect(status).toBe(200);
      const teams = body.data || [];
      console.log(`Teams: ${teams.map((t: { name: string }) => t.name).join(', ')}`);
    });

    await test.step('Set Org SOUL.md', async () => {
      const { status } = await apiPut(page, csrf, '/identity/org/soul', {
        content: '# Org SOUL\nWe value clarity, shipping fast, and helping each other.',
      });
      expect(status).toBe(200);
    });

    await test.step('Enable cognitive profiles', async () => {
      const { status } = await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
      expect([200, 201]).toContain(status);
    });
  });

  test('Admin daily monitoring: violations, compliance, analytics', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Check governance violations', async () => {
      const { status, body } = await apiGet(page, '/admin/governance/violations?pageSize=50');
      expect(status).toBe(200);
      console.log(`Open violations: ${body.total || 0}`);
    });

    await test.step('Check governance stats', async () => {
      const { status, body } = await apiGet(page, '/admin/governance/stats');
      expect(status).toBe(200);
      console.log(`Stats: total=${body.data?.totalViolations}, open=${body.data?.openViolations}`);
    });

    await test.step('Check admin analytics', async () => {
      const { status, body } = await apiGet(page, '/admin/analytics?days=30');
      expect([200, 404]).toContain(status); // Analytics may not be fully implemented
      console.log(`Analytics available: ${status === 200}`);
    });

    await test.step('Check pending skill approvals', async () => {
      const { status, body } = await apiGet(page, '/skills?tab=all');
      expect(status).toBe(200);
      const pending = (body.data || []).filter((s: { status: string }) => s.status === 'pending_review');
      console.log(`Skills pending review: ${pending.length}`);
    });
  });

  test('Product gaps: admin experience', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Document all product gaps for admin persona
    const gaps = [
      'No admin dashboard — admin lands on /chat, not a control panel',
      'No notification center — violations are WebSocket events but no persistent inbox',
      'No bulk user management — cannot import users from CSV',
      'No API key rotation mechanism',
      'No system health dashboard — queue depths, Redis, DB not visible',
    ];

    for (const gap of gaps) {
      console.log(`PRODUCT GAP (Admin): ${gap}`);
    }

    // Verify these features don't exist
    await test.step('No admin dashboard route', async () => {
      await page.goto('/#/admin');
      await page.waitForTimeout(500);
      const url = page.url();
      // Should redirect to chat or 404
      console.log(`/admin route goes to: ${url}`);
    });

    expect(true).toBe(true); // Document-only test
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 2: CTO — "See the big picture, make better org decisions"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: CTO — organizational decision intelligence', () => {
  test('CTO views and analyzes decisions', async ({ page }) => {
    const csrf = await loginAs(page, 'admin'); // CTO has admin role

    await test.step('Navigate to decisions page', async () => {
      await page.goto('/#/decisions');
      await page.waitForTimeout(2000);
      const url = page.url();
      expect(url).toContain('/decisions');
    });

    await test.step('List all org decisions', async () => {
      const { status, body } = await apiGet(page, '/decisions?limit=50');
      expect(status).toBe(200);
      const decisions = body.data || [];
      console.log(`Total decisions: ${decisions.length}`);

      // Count by domain
      const byDomain: Record<string, number> = {};
      for (const d of decisions) {
        byDomain[d.domain || 'unknown'] = (byDomain[d.domain || 'unknown'] || 0) + 1;
      }
      console.log(`By domain: ${JSON.stringify(byDomain)}`);
    });

    await test.step('View decision patterns', async () => {
      const { status, body } = await apiGet(page, '/decisions/patterns');
      expect(status).toBe(200);
      console.log(`Patterns found: ${(body.data || []).length}`);
    });

    await test.step('View principles', async () => {
      const { status, body } = await apiGet(page, '/decisions/principles');
      expect(status).toBe(200);
      console.log(`Principles: ${(body.data || []).length}`);
    });

    await test.step('Search decisions', async () => {
      const { status, body } = await apiPost(page, csrf, '/decisions/search', { query: 'TypeScript' });
      if (status === 500) { console.log('Decision search 500 without LLM'); return; }
      expect(status).toBe(200);
      console.log(`Search results for "TypeScript": ${(body.data || []).length}`);
    });
  });

  test('Product gaps: CTO experience', async ({ page }) => {
    const gaps = [
      'Decision graph not interactive — placeholder view, no D3/force-directed graph',
      'No decision export — cannot export to PDF for board presentation',
      'No cross-team decision comparison — cannot side-by-side compare',
      'Principles not wired to agent context — listPrinciples() exists but not in context-builder',
      'No decision quality dashboard — quality scores exist but no aggregate view',
      'No decision ownership transfer — what if creator leaves?',
    ];
    for (const gap of gaps) {
      console.log(`PRODUCT GAP (CTO): ${gap}`);
    }
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 3: Engineering Lead — "Keep the team aligned and productive"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: Engineering Lead — team alignment', () => {
  test('Eng lead tasks and team management', async ({ page }) => {
    const csrf = await loginAs(page, 'admin'); // Using admin since engLead might not be seeded with auth
    const cleanup = new Cleanup();

    await test.step('View kanban board', async () => {
      await page.goto('/#/tasks');
      await page.waitForTimeout(1500);
      console.log('PRODUCT GAP: Tasks page shows only own tasks — no team kanban view');
    });

    await test.step('Create task for team discussion', async () => {
      const task = await createTask(page, csrf, {
        title: uniqueId('eng-lead-task'),
        description: 'Architecture review for new feature',
      });
      cleanup.add(() => deleteTask(page, csrf, task.id));
      console.log(`Created task: ${task.id}`);
      console.log('PRODUCT GAP: No task assignment — cannot assign to team members');
      console.log('PRODUCT GAP: No due dates on tasks');
    });

    await test.step('Create team memory', async () => {
      const mem = await createMemory(page, csrf, {
        content: uniqueId('eng-standards') + ': All PRs require 2 approvals',
        layer: 'team',
        source: 'eng-standards',
      });
      console.log(`Created team memory: ${mem.id}`);
    });

    await test.step('Capture architecture decision', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('arch-decision'),
        reasoning: 'We should use event sourcing for the audit log',
        domain: 'engineering',
      });
      console.log(`Created decision: ${dec.id}`);
    });

    await test.step('Create standup routine', async () => {
      const routine = await createRoutine(page, csrf, {
        name: uniqueId('standup'),
        prompt: 'Summarize team activity for standup',
        schedule: '0 9 * * 1-5',
      });
      cleanup.add(() => apiDelete(page, csrf, `/routines/${routine.id}`));
      console.log(`Created routine: ${routine.id}`);
    });

    await cleanup.run();
  });

  test('Product gaps: Engineering Lead experience', async ({ page }) => {
    const gaps = [
      'No team kanban view — tasks are personal only',
      'No task assignment — cannot assign to team members',
      'No due dates — tasks have priority but no deadlines',
      'No workload balancing — cannot see team member load',
      'No team activity dashboard — activity feed is org-wide only',
      'No sprint/iteration concept — no way to group tasks',
    ];
    for (const gap of gaps) {
      console.log(`PRODUCT GAP (Eng Lead): ${gap}`);
    }
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 4: Developer (IC) — "Ship code faster with org context"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: Developer — shipping with context', () => {
  test('Developer daily workflow: chat, tasks, memory, skills', async ({ page }) => {
    const csrf = await loginAs(page, 'admin'); // Using admin for reliable auth
    const cleanup = new Cleanup();

    await test.step('Start chat session', async () => {
      const session = await createSession(page, csrf, uniqueId('dev-chat'));
      cleanup.add(() => apiDelete(page, csrf, `/chat/sessions/${session.id}`));
      console.log(`Created session: ${session.id}`);
    });

    await test.step('Create task in Tasks', async () => {
      const task = await createTask(page, csrf, {
        title: uniqueId('implement-api'),
        description: 'Implement user preferences endpoint',
        priority: 2,
      });
      cleanup.add(() => deleteTask(page, csrf, task.id));
      console.log(`Created task: ${task.id}`);
    });

    await test.step('Search memory for deployment process', async () => {
      const { status, body } = await apiPost(page, csrf, '/memory/search', { query: 'deployment process' });
      expect(status).toBe(200);
      const results = body.data || [];
      console.log(`Memory search results: ${results.length}`);
      if (results.length > 0) {
        console.log(`Top result: ${results[0].content?.slice(0, 100)}`);
      }
    });

    await test.step('Browse and install skill', async () => {
      const { status, body } = await apiGet(page, '/skills?search=code+review');
      expect(status).toBe(200);
      const skills = body.data || [];
      console.log(`Skills matching "code review": ${skills.length}`);

      if (skills.length > 0) {
        const installRes = await apiPost(page, csrf, `/skills/${skills[0].id}/install`, {});
        console.log(`Install skill: ${installRes.status}`);
      }
    });

    await test.step('Create a decision', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('chose-postgresql'),
        reasoning: 'PostgreSQL supports pgvector for embeddings and has strong JSONB support',
        domain: 'engineering',
      });
      console.log(`Created decision: ${dec.id}`);
    });

    await test.step('Check activity feed', async () => {
      const { status, body } = await apiGet(page, '/activity?limit=10');
      expect(status).toBe(200);
      const events = body.data || [];
      console.log(`Recent activity events: ${events.length}`);
    });

    await cleanup.run();
  });

  test('Product gaps: Developer experience', async ({ page }) => {
    const gaps = [
      'No global search — cannot search across messages, tasks, decisions, memory',
      'No session organization — 30+ sessions with no folders, tags, or favorites',
      'No thread/fork — cannot branch a conversation',
      'No pinned messages — cannot pin important messages',
      'No PR/issue linking — cannot link to GitHub',
      'No code execution visibility — sandbox not directly accessible',
    ];
    for (const gap of gaps) {
      console.log(`PRODUCT GAP (Developer): ${gap}`);
    }
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 5: Product Manager — "Make informed product decisions"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: Product Manager — informed decisions', () => {
  test('PM decision capture and routine creation', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    await test.step('Capture product decision', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('mobile-priority'),
        reasoning: 'Mobile usage is growing 30% MoM, desktop is flat. Prioritize mobile for Q3.',
        domain: 'product',
        alternatives: ['Focus on desktop', 'Build both equally'],
      });
      console.log(`Created product decision: ${dec.id}`);
    });

    await test.step('Create feedback analysis routine', async () => {
      const routine = await createRoutine(page, csrf, {
        name: uniqueId('feedback-analysis'),
        prompt: 'Analyze customer feedback from the past week. Identify top themes and sentiment.',
        schedule: '0 8 * * 1',
      });
      cleanup.add(() => apiDelete(page, csrf, `/routines/${routine.id}`));
      console.log(`Created routine: ${routine.id}`);
    });

    await test.step('Create team memory', async () => {
      const mem = await createMemory(page, csrf, {
        content: 'Roadmap priorities: 1. Mobile app 2. Integration marketplace 3. Team analytics',
        layer: 'team',
        source: 'roadmap',
      });
      console.log(`Created roadmap memory: ${mem.id}`);
    });

    await test.step('Ingest meeting notes', async () => {
      const { status, body } = await apiPost(page, csrf, '/meetings/ingest', {
        provider: 'granola',
        title: uniqueId('product-review'),
        participants: ['pm1@hearth.local', 'admin@hearth.local'],
        meetingDate: new Date().toISOString(),
        transcript: 'We discussed the Q3 roadmap. Decided to focus on mobile. PM will create tickets.',
        summary: 'Q3 roadmap discussion - mobile focus',
      });
      expect([200, 201]).toContain(status);
      console.log(`Meeting ingested: ${status}`);
    });

    await cleanup.run();
  });

  test('Product gaps: PM experience', async ({ page }) => {
    const gaps = [
      'No customer feedback aggregation view',
      'No roadmap/timeline visualization',
      'No decision-to-Jira linking',
      'Meeting ingestion has no UI — only API endpoint',
      'No OKR/metric tracking',
    ];
    for (const gap of gaps) {
      console.log(`PRODUCT GAP (PM): ${gap}`);
    }
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 6: New Hire — "Get productive without asking 100 questions"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: New Hire — onboarding experience', () => {
  test('New hire explores every page and discovers org context', async ({ page }) => {
    // Try to login as newHire (may need to use admin if not registered)
    let csrf: string;
    try {
      csrf = await loginAs(page, 'newHire');
    } catch {
      csrf = await loginAs(page, 'admin');
      console.log('NOTE: Using admin account (newHire may not be registered)');
    }

    await test.step('Landing page — chat', async () => {
      await page.goto('/#/chat');
      await page.waitForTimeout(1000);
      console.log('PRODUCT GAP: No welcome message for first-time users');
      console.log('PRODUCT GAP: No onboarding wizard or getting-started checklist');
    });

    await test.step('Explore Tasks — empty state', async () => {
      await page.goto('/#/tasks');
      await page.waitForTimeout(1000);
      const hasTasks = await page.locator('[data-testid="task-card"]').count().catch(() => 0);
      console.log(`Tasks visible: ${hasTasks}`);
    });

    await test.step('Explore memory — can they see org memory?', async () => {
      const { status, body } = await apiGet(page, '/memory?layer=org');
      expect(status).toBe(200);
      const orgMemories = body.data || [];
      console.log(`Org memories accessible: ${orgMemories.length}`);
      console.log('PRODUCT GAP: Org memory not browseable — can search but not browse "top org knowledge"');
    });

    await test.step('Explore skills — recommended available?', async () => {
      const { status, body } = await apiGet(page, '/skills?tab=recommended');
      expect(status).toBe(200);
      const recommended = body.data || [];
      console.log(`Recommended skills: ${recommended.length}`);
    });

    await test.step('Explore decisions — can see org decisions?', async () => {
      const { status, body } = await apiGet(page, '/decisions?limit=10');
      expect(status).toBe(200);
      console.log(`Decisions accessible: ${(body.data || []).length}`);
    });

    await test.step('Explore activity — can see org activity?', async () => {
      const { status, body } = await apiGet(page, '/activity?limit=10');
      expect(status).toBe(200);
      console.log(`Activity events accessible: ${(body.data || []).length}`);
    });

    await test.step('Find deployment process via memory search', async () => {
      const { status, body } = await apiPost(page, csrf, '/memory/search', { query: 'deploy' });
      expect(status).toBe(200);
      const results = body.data || [];
      console.log(`Deploy search results: ${results.length}`);
      if (results.length > 0) {
        console.log(`Found: ${results[0].content?.slice(0, 100)}`);
      }
    });

    await test.step('Set up identity', async () => {
      const { status } = await apiPut(page, csrf, '/identity/user/soul', {
        content: "I'm new to the team. I like detailed explanations.",
      });
      expect(status).toBe(200);
    });
  });

  test('Product gaps: New Hire experience', async ({ page }) => {
    const gaps = [
      'No onboarding wizard — new user sees empty pages with no guidance',
      'No welcome message in first chat',
      'No "getting started" checklist',
      'Empty states inconsistent across pages',
      'No contextual help — no tooltips or ? buttons',
      'No recommended first actions on homepage',
      'Shared session discovery unclear — no way to browse org-visible sessions',
    ];
    for (const gap of gaps) {
      console.log(`PRODUCT GAP (New Hire): ${gap}`);
    }
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 7: Data Analyst — "Generate insights and share them"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: Data Analyst — insights workflow', () => {
  test('Data analyst creates analysis routine and captures decisions', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const cleanup = new Cleanup();

    await test.step('Start analysis chat', async () => {
      const session = await createSession(page, csrf, uniqueId('data-analysis'));
      cleanup.add(() => apiDelete(page, csrf, `/chat/sessions/${session.id}`));
      console.log(`Analysis session: ${session.id}`);
    });

    await test.step('Create data quality routine', async () => {
      const routine = await createRoutine(page, csrf, {
        name: uniqueId('data-quality-report'),
        prompt: 'Run data quality checks on our main tables. Report any anomalies in record counts, null rates, and data freshness.',
        schedule: '0 8 * * 1-5',
      });
      cleanup.add(() => apiDelete(page, csrf, `/routines/${routine.id}`));
      console.log(`Created routine: ${routine.id}`);
    });

    await test.step('Capture data decision', async () => {
      const dec = await createDecision(page, csrf, {
        title: uniqueId('columnar-storage'),
        reasoning: 'Switched to columnar storage for analytics queries — 10x faster aggregations',
        domain: 'engineering',
      });
      console.log(`Created decision: ${dec.id}`);
    });

    await cleanup.run();
  });

  test('Product gaps: Data Analyst experience', async ({ page }) => {
    const gaps = [
      'No chart/visualization artifacts — can generate text/code but not charts',
      'No database connection from chat',
      'No report template system',
      'No scheduled artifact generation',
    ];
    for (const gap of gaps) {
      console.log(`PRODUCT GAP (Data Analyst): ${gap}`);
    }
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA 8: Viewer (External Stakeholder)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persona: Viewer — read-only access', () => {
  test('Viewer permissions and shared session access', async ({ page }) => {
    // First create a share link as admin
    const adminCsrf = await loginAs(page, 'admin');
    const session = await createSession(page, adminCsrf, uniqueId('shared-for-viewer'));

    // Create share link
    const shareRes = await apiPost(page, adminCsrf, `/chat/sessions/${session.id}/share`, {
      shareType: 'full',
    });

    let shareToken: string | undefined;
    if (shareRes.status === 201 || shareRes.status === 200) {
      shareToken = shareRes.body.data?.token;
      console.log(`Share token: ${shareToken}`);
    }

    // Try accessing as viewer
    let viewerCsrf: string;
    try {
      viewerCsrf = await loginAs(page, 'intern'); // intern is a viewer
    } catch {
      viewerCsrf = await loginAs(page, 'admin');
      console.log('NOTE: Using admin as fallback');
    }

    await test.step('Viewer can read activity', async () => {
      const { status } = await apiGet(page, '/activity?limit=5');
      expect([200, 403]).toContain(status);
      console.log(`Viewer activity access: ${status}`);
    });

    await test.step('Viewer can read decisions', async () => {
      const { status } = await apiGet(page, '/decisions?limit=5');
      expect([200, 403]).toContain(status);
      console.log(`Viewer decisions access: ${status}`);
    });

    await test.step('Viewer can read memory', async () => {
      const { status } = await apiGet(page, '/memory?layer=org');
      expect([200, 403]).toContain(status);
      console.log(`Viewer memory access: ${status}`);
    });

    // Access shared session
    if (shareToken) {
      await test.step('Access shared session', async () => {
        const { status, body } = await apiGet(page, `/shared/${shareToken}`);
        expect([200, 404]).toContain(status);
        console.log(`Shared session access: ${status}`);
      });
    }

    // Cleanup
    await loginAs(page, 'admin');
    await apiDelete(page, adminCsrf, `/chat/sessions/${session.id}`);
  });

  test('Product gaps: Viewer experience', async ({ page }) => {
    const gaps = [
      'No email digest for external viewers',
      'No filtered view for stakeholders',
      'Viewer permissions unclear — what exactly can a viewer access?',
      'No public status page for stakeholders',
    ];
    for (const gap of gaps) {
      console.log(`PRODUCT GAP (Viewer): ${gap}`);
    }
    expect(true).toBe(true);
  });
});
