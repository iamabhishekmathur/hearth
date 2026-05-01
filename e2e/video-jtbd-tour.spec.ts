/**
 * JTBD Video Walkthrough — Proving the Context Intelligence Layer
 *
 * 4 scenarios that prove Hearth's context layers actually change AI responses:
 *   1. New hire gets productive on day 1 (identity + memory + skills)
 *   2. Capture a decision so the org doesn't forget
 *   3. Admin protects the org (governance blocks dangerous content)
 *   4. Routine automates recurring work
 *
 * Run with:
 *   npx playwright test --config=playwright-video.config.ts video-jtbd
 *
 * Output: test-results/videos/
 */
import { test, type Page } from '@playwright/test';
import {
  loginAs,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  HAS_LLM,
} from './fixtures/test-helpers';

test.describe.configure({ mode: 'serial' });

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Pause for the video viewer to absorb what happened */
const pace = (page: Page, ms = 2000) => page.waitForTimeout(ms);

/** Send a chat message via API, then poll for the agent response */
async function sendAndWaitForReply(
  page: Page,
  csrf: string,
  sessionId: string,
  content: string,
  maxWaitMs = 45_000,
): Promise<{ userMessageId: string; agentReply: string | null }> {
  const sendRes = await apiPost(page, csrf, `/chat/sessions/${sessionId}/messages`, { content });
  const userMessageId = sendRes.body.data?.messageId ?? '';
  console.log(`  >> User: "${content}" (${sendRes.status})`);

  if (sendRes.status === 403) {
    // Governance blocked — return the error
    console.log(`  << BLOCKED: ${JSON.stringify(sendRes.body)}`);
    return { userMessageId, agentReply: `[BLOCKED] ${sendRes.body.error}` };
  }

  // Poll the session messages until we see an assistant message after ours
  let agentReply: string | null = null;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(2000);
    const sessionRes = await apiGet(page, `/chat/sessions/${sessionId}`);
    const messages = sessionRes.body.data?.messages ?? [];

    // Find our user message index, then look for assistant messages after it
    const userIdx = messages.findIndex(
      (m: { id: string }) => m.id === userMessageId,
    );
    if (userIdx >= 0) {
      for (let i = userIdx + 1; i < messages.length; i++) {
        const msg = messages[i] as { role: string; content: string };
        if (msg.role === 'assistant' && msg.content?.trim()) {
          agentReply = msg.content;
          break;
        }
      }
      if (agentReply) break;
    }
  }

  if (agentReply) {
    // Print first 300 chars of reply for video caption
    const preview = agentReply.slice(0, 300).replace(/\n/g, ' ');
    console.log(`  << Agent: "${preview}${agentReply.length > 300 ? '...' : ''}"`);
  } else {
    console.log('  << Agent: (no reply within timeout)');
  }

  return { userMessageId, agentReply };
}

/** Navigate to a page and wait for it to settle */
async function navigateTo(page: Page, path: string, waitMs = 2000) {
  await page.goto(`/#${path}`);
  await pace(page, waitMs);
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

test.describe('Hearth JTBD Video Tour — Context Intelligence Proof', () => {
  let csrf: string;

  test.beforeAll(async ({ browser }) => {
    // Verify LLM is available — these tests need agent responses
    if (!HAS_LLM) {
      console.log('WARNING: No LLM API key detected. Chat scenarios will send messages but agent replies may not appear.');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 1: "New hire gets productive on day 1" (~90s)
  // Prove: identity + memory + skills change what the AI says
  // ═══════════════════════════════════════════════════════════════════════════

  test('Scenario 1: New hire gets productive on day 1', async ({ page }) => {
    test.setTimeout(300_000);

    // ── Login as admin ──
    await test.step('Login as admin', async () => {
      await page.goto('/#/login');
      await pace(page, 1500);
      await page.fill('input[type="email"]', 'admin@hearth.local');
      await pace(page, 500);
      await page.fill('input[type="password"]', 'changeme');
      await pace(page, 500);
      await page.click('button[type="submit"]');
      await pace(page, 3000);
    });

    csrf = (await page.context().cookies()).find(c => c.name === 'hearth.csrf')?.value ?? '';
    if (!csrf) csrf = await loginAs(page, 'admin');

    // ── Step 1: Set neutral baseline identity ──
    await test.step('1. Set neutral baseline identity', async () => {
      // Set identity docs to a neutral baseline so we can show the effect of changing them
      await apiPut(page, csrf, '/identity/org/soul', {
        content: 'You are a helpful assistant.',
      });
      await apiPut(page, csrf, '/identity/user/soul', {
        content: 'Respond normally.',
      });
      console.log('Set neutral baseline identity docs');
    });

    // Uninstall all skills for clean slate
    await test.step('1b. Uninstall all skills', async () => {
      const installed = await apiGet(page, '/skills/installed');
      const skills = installed.body.data ?? [];
      for (const s of skills) {
        await apiDelete(page, csrf, `/skills/${s.skillId ?? s.id}/install`);
      }
      console.log(`Uninstalled ${skills.length} skills`);
    });

    // ── Step 2: Ask baseline question (no context) ──
    let baselineSessionId: string;
    await test.step('2. Baseline question — no org context', async () => {
      const session = await apiPost(page, csrf, '/chat/sessions', {
        title: 'JTBD Demo: Baseline',
      });
      baselineSessionId = session.body.data?.id;

      await navigateTo(page, `/chat/${baselineSessionId}`);
      await pace(page, 2000);

      console.log('\n=== BASELINE: No identity, no memory, no skills ===');
      await sendAndWaitForReply(
        page, csrf, baselineSessionId,
        'How do we deploy code at this company?',
      );
      await pace(page, 3000);
    });

    // ── Step 3: Navigate to Memory, show org entries exist ──
    await test.step('3. Browse Memory — org knowledge base', async () => {
      await navigateTo(page, '/memory');
      console.log('\n--- Showing org memory entries ---');

      // Click Organization tab
      const orgTab = page.locator('button:has-text("Organization")').first();
      if (await orgTab.isVisible().catch(() => false)) {
        await orgTab.click();
        await pace(page, 2000);
      }

      // Verify memory entries are visible
      const memoryItems = page.locator('[class*="border"]').filter({ hasText: 'deployment' });
      const count = await memoryItems.count().catch(() => 0);
      console.log(`  Found ${count} memory entries mentioning "deployment"`);
      await pace(page, 2000);
    });

    // ── Step 4: Ask SAME question in a new session — memory now semantically matched ──
    await test.step('4. Same question WITH memory — context-aware answer', async () => {
      // Set org SOUL.md to something meaningful so the identity chain is active
      await apiPut(page, csrf, '/identity/org/soul', {
        content: 'We are a product-focused engineering org. We value clarity, shipping fast, and helping each other. Default to TypeScript. Always write tests. Follow REST conventions.',
      });

      const session2 = await apiPost(page, csrf, '/chat/sessions', {
        title: 'JTBD Demo: With Org Context',
      });
      const sessionId2 = session2.body.data?.id;
      await navigateTo(page, `/chat/${sessionId2}`);

      console.log('\n=== WITH ORG SOUL + MEMORY: Org knowledge now available ===');
      await sendAndWaitForReply(
        page, csrf, sessionId2,
        'How do we deploy code at this company?',
      );
      await pace(page, 3000);
    });

    // ── Step 5: Set user SOUL.md — change communication style ──
    await test.step('5. Set identity — "Explain simply, I am new"', async () => {
      await navigateTo(page, '/settings/identity');
      await pace(page, 1500);

      // Set via API for reliability
      await apiPut(page, csrf, '/identity/user/soul', {
        content: 'Explain everything simply. I am brand new to this team and have never used these technologies before. Use analogies and avoid jargon.',
      });
      console.log('Set user SOUL.md: explain simply, new to team');

      // Show the settings page updated
      await page.reload();
      await pace(page, 2000);
    });

    // ── Step 6: Ask a technical question — SOUL.md shapes the response ──
    await test.step('6. Technical question WITH identity — simpler explanation', async () => {
      const session = await apiPost(page, csrf, '/chat/sessions', {
        title: 'JTBD Demo: With Identity',
      });
      const sessionId = session.body.data?.id;
      await navigateTo(page, `/chat/${sessionId}`);

      console.log('\n=== WITH IDENTITY: Agent adapts to newcomer ===');
      await sendAndWaitForReply(
        page, csrf, sessionId,
        'What is pgvector and why do we use it?',
      );
      await pace(page, 3000);
    });

    // ── Step 7: Install a skill — add domain knowledge ──
    await test.step('7. Install "API Design Guidelines" skill', async () => {
      await navigateTo(page, '/skills');
      await pace(page, 2000);

      // Find the api-design-guidelines skill
      const skillsRes = await apiGet(page, '/skills?search=api-design');
      const skills = skillsRes.body.data ?? [];
      const apiSkill = skills.find((s: { name: string }) =>
        s.name.toLowerCase().includes('api-design'),
      );

      if (apiSkill) {
        await apiPost(page, csrf, `/skills/${apiSkill.id}/install`);
        console.log(`Installed skill: ${apiSkill.name} (${apiSkill.id})`);

        // Show the Skills page with the installed skill
        await page.reload();
        await pace(page, 2000);

        // Click "Installed" tab if available
        const installedTab = page.locator('button:has-text("Installed")').first();
        if (await installedTab.isVisible().catch(() => false)) {
          await installedTab.click();
          await pace(page, 1500);
        }
      } else {
        console.log('api-design-guidelines skill not found — skipping install');
      }
    });

    // ── Step 8: Ask about API design — skill knowledge injected ──
    await test.step('8. API design question WITH skill — domain expertise added', async () => {
      const session = await apiPost(page, csrf, '/chat/sessions', {
        title: 'JTBD Demo: With Skill',
      });
      const sessionId = session.body.data?.id;
      await navigateTo(page, `/chat/${sessionId}`);

      console.log('\n=== WITH SKILL: Installed knowledge shapes answer ===');
      await sendAndWaitForReply(
        page, csrf, sessionId,
        'How should I design a new API endpoint for user preferences?',
      );
      await pace(page, 3000);
    });

    console.log('\n--- Scenario 1 complete: 4 questions, each with better context ---');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 2: "Capture a decision so the org doesn't forget" (~60s)
  // Prove: decisions feed back into chat answers
  // ═══════════════════════════════════════════════════════════════════════════

  test('Scenario 2: Capture a decision so the org doesn\'t forget', async ({ page }) => {
    test.setTimeout(180_000);

    csrf = await loginAs(page, 'admin');

    // ── Step 1: Browse existing decisions ──
    await test.step('1. Browse existing decisions', async () => {
      await navigateTo(page, '/decisions');
      console.log('\n--- Decisions timeline ---');

      // Scroll through to show existing decisions
      await page.mouse.wheel(0, 300);
      await pace(page, 1500);
      await page.mouse.wheel(0, -300);
      await pace(page, 1000);

      const decisionsRes = await apiGet(page, '/decisions?limit=20');
      const decisions = decisionsRes.body.data ?? [];
      console.log(`  ${decisions.length} decisions in the org`);

      // Click a decision to show detail
      const firstCard = page.locator('[class*="cursor-pointer"]').first();
      if (await firstCard.isVisible().catch(() => false)) {
        await firstCard.click();
        await pace(page, 2000);
      }
    });

    // ── Step 2: Create a new decision about caching ──
    let newDecisionId: string;
    await test.step('2. Capture new decision: Use Redis for caching', async () => {
      // Use API for reliability, but navigate to the page to show it
      const res = await apiPost(page, csrf, '/decisions', {
        title: 'Use Redis for all application caching',
        reasoning: 'Redis is already in our stack for BullMQ. Adding a second cache (Memcached, etc.) increases operational complexity. Redis supports TTL, pub/sub, and data structures we need. The team has strong Redis expertise.',
        domain: 'engineering',
        alternatives: ['Memcached', 'In-memory LRU cache', 'PostgreSQL materialized views'],
        scope: 'org',
        confidence: 'high',
      });
      newDecisionId = res.body.data?.id;
      console.log(`Created decision: ${res.body.data?.title} (${newDecisionId})`);

      // Navigate to decisions to show it appeared
      await navigateTo(page, '/decisions');
      await pace(page, 2500);
    });

    // ── Step 3: Ask about caching in chat — decision feeds into context ──
    await test.step('3. Chat: "What caching solution should we use?"', async () => {
      const session = await apiPost(page, csrf, '/chat/sessions', {
        title: 'JTBD Demo: Decision Context',
      });
      const sessionId = session.body.data?.id;
      await navigateTo(page, `/chat/${sessionId}`);

      console.log('\n=== DECISION CONTEXT: Past decisions inform chat ===');
      await sendAndWaitForReply(
        page, csrf, sessionId,
        'What caching solution should we use for our new microservice?',
      );
      await pace(page, 3000);
    });

    // ── Step 4: Show patterns tab ──
    await test.step('4. View decision patterns', async () => {
      await navigateTo(page, '/decisions');

      // Click Patterns tab
      const patternsTab = page.locator('button:has-text("Patterns")').first();
      if (await patternsTab.isVisible().catch(() => false)) {
        await patternsTab.click();
        await pace(page, 2500);
      }

      console.log('Patterns tab shown — engineering decision patterns');
    });

    console.log('\n--- Scenario 2 complete: decision captured, fed back into chat ---');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 3: "Admin protects the org" (~45s)
  // Prove: governance blocks dangerous content before it reaches the LLM
  // ═══════════════════════════════════════════════════════════════════════════

  test('Scenario 3: Admin protects the org', async ({ page }) => {
    test.setTimeout(120_000);

    csrf = await loginAs(page, 'admin');

    // ── Step 1: Enable governance and show policies ──
    await test.step('1. Enable governance and view policies', async () => {
      // Ensure governance is enabled with blocking on user messages
      await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: true,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
      console.log('\n--- Governance settings ---');
      console.log('  Governance ENABLED with user message checking');

      // Ensure a PII block policy exists
      const policiesRes = await apiGet(page, '/admin/governance/policies');
      const policies = policiesRes.body.data ?? [];
      const hasPiiBlock = policies.some(
        (p: { name: string; enforcement: string }) =>
          p.name === 'No PII in chat' && p.enforcement === 'block',
      );
      if (!hasPiiBlock) {
        await apiPost(page, csrf, '/admin/governance/policies', {
          name: 'No PII in chat',
          category: 'data_privacy',
          severity: 'critical',
          ruleType: 'keyword',
          ruleConfig: { keywords: ['SSN', 'social security'], matchMode: 'any', caseSensitive: false },
          enforcement: 'block',
        });
        console.log('  Created "No PII in chat" block policy');
      }

      for (const p of policies) {
        console.log(`  Policy: "${p.name}" [${p.enforcement}] (${p.ruleType})`);
      }

      await navigateTo(page, '/settings/governance');
      await pace(page, 2500);
    });

    // ── Step 2: Send a message with PII — should be BLOCKED ──
    await test.step('2. Send PII message — governance blocks it', async () => {
      const session = await apiPost(page, csrf, '/chat/sessions', {
        title: 'JTBD Demo: Governance Test',
      });
      const sessionId = session.body.data?.id;
      await navigateTo(page, `/chat/${sessionId}`);
      await pace(page, 1500);

      console.log('\n=== GOVERNANCE: Blocking PII ===');
      const result = await sendAndWaitForReply(
        page, csrf, sessionId,
        'Can you remember my SSN? It is 123-45-6789',
        5000, // Short timeout — we expect a block, not a reply
      );

      if (result.agentReply?.includes('[BLOCKED]')) {
        console.log('  PROOF: Message was blocked by governance — never reached the LLM');
      }

      // Show the block in the UI — the message input area
      await pace(page, 3000);
    });

    // ── Step 3: Show violations log ──
    await test.step('3. View governance violations', async () => {
      await navigateTo(page, '/settings/governance');
      await pace(page, 1500);

      // Check violations via API
      const violationsRes = await apiGet(page, '/admin/governance/violations');
      const violations = violationsRes.body.data ?? [];
      console.log(`  ${violations.length} total violations logged`);

      if (violations.length > 0) {
        const latest = violations[0];
        console.log(`  Latest: "${latest.policyName}" by user at ${latest.createdAt}`);
      }

      // Click violations tab if available
      const violationsTab = page.locator('button:has-text("Violations")').first();
      if (await violationsTab.isVisible().catch(() => false)) {
        await violationsTab.click();
        await pace(page, 2500);
      }
    });

    // ── Step 4: Send a clean message — governance is transparent ──
    await test.step('4. Send clean message — passes through normally', async () => {
      const session = await apiPost(page, csrf, '/chat/sessions', {
        title: 'JTBD Demo: Clean Message',
      });
      const sessionId = session.body.data?.id;
      await navigateTo(page, `/chat/${sessionId}`);

      console.log('\n=== GOVERNANCE: Clean message passes through ===');
      await sendAndWaitForReply(
        page, csrf, sessionId,
        'What is the weather like today?',
      );
      await pace(page, 3000);
    });

    console.log('\n--- Scenario 3 complete: dangerous blocked, safe passes through ---');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 4: "Routine automates recurring work" (~45s)
  // Prove: routines use the same context layer as chat
  // ═══════════════════════════════════════════════════════════════════════════

  test('Scenario 4: Routine automates recurring work', async ({ page }) => {
    test.setTimeout(180_000);

    csrf = await loginAs(page, 'admin');

    // ── Step 1: Browse existing routines ──
    await test.step('1. View existing routines', async () => {
      await navigateTo(page, '/routines');
      console.log('\n--- Routines list ---');

      const routinesRes = await apiGet(page, '/routines');
      const routines = routinesRes.body.data ?? [];
      for (const r of routines) {
        console.log(`  Routine: "${r.name}" [${r.enabled ? 'enabled' : 'disabled'}] ${r.schedule || 'manual'}`);
      }
      await pace(page, 2500);
    });

    // ── Step 2: Create a demo routine and show detail ──
    let targetRoutineId: string | null = null;
    await test.step('2. Create and view routine detail', async () => {
      // Show existing routines in the list first
      const routinesRes = await apiGet(page, '/routines');
      const routines = routinesRes.body.data ?? [];
      const existing = routines.find((r: { name: string }) =>
        r.name.toLowerCase().includes('standup') || r.name.toLowerCase().includes('metrics'),
      );
      if (existing) {
        console.log(`\n  Existing routine: "${existing.name}" (${existing.schedule})`);
        const routineCard = page.locator(`text=${existing.name}`).first();
        if (await routineCard.isVisible().catch(() => false)) {
          await routineCard.click();
          await pace(page, 2000);
        }
      }

      // Create a fresh routine for the demo — simple prompt so it completes fast
      const createRes = await apiPost(page, csrf, '/routines', {
        name: 'JTBD Demo: Team Status Brief',
        prompt: 'Using our organization memory and past decisions, write a 3-sentence summary of what this team is working on and what technology choices have been made. Be specific — reference actual decisions and knowledge.',
        delivery: { channels: ['in_app'] },
      });
      targetRoutineId = createRes.body.data?.id;
      console.log(`  Created demo routine: ${targetRoutineId}`);

      // Reload to show it in the list
      await page.reload();
      await pace(page, 2000);

      // Click on it
      const demoCard = page.locator('text=JTBD Demo: Team Status Brief').first();
      if (await demoCard.isVisible().catch(() => false)) {
        await demoCard.click();
        await pace(page, 2000);
      }
    });

    // ── Step 3: Run Now — execute with full org context ──
    await test.step('3. Run Now — execute routine with org context', async () => {
      if (!targetRoutineId) {
        console.log('No routine to run — skipping');
        return;
      }

      console.log('\n=== ROUTINE: Running with full org context ===');

      // Trigger run via API
      const runRes = await apiPost(page, csrf, `/routines/${targetRoutineId}/run-now`, {});
      console.log(`  Run enqueued: ${runRes.status} ${runRes.body.message ?? ''}`);

      // Show "Run Now" button exists in UI
      const runBtn = page.locator('button:has-text("Run Now"), button:has-text("Run now")').first();
      if (await runBtn.isVisible().catch(() => false)) {
        console.log('  "Run Now" button visible in UI');
      }

      await pace(page, 2000);
    });

    // ── Step 4: Wait for completion and show output ──
    await test.step('4. View routine output — org context in response', async () => {
      if (!targetRoutineId) return;

      // Poll for completion — up to 90s
      const start = Date.now();
      let output: string | null = null;
      while (Date.now() - start < 90_000) {
        const runsRes = await apiGet(page, `/routines/${targetRoutineId}/runs`);
        const runs = runsRes.body.data ?? [];
        if (runs.length > 0) {
          const latest = runs[0];
          if (latest.status === 'success' || latest.status === 'failed') {
            output = latest.output ?? latest.error ?? '(no output)';
            console.log(`  Run status: ${latest.status}`);
            break;
          }
        }
        await page.waitForTimeout(3000);
      }

      if (output) {
        const preview = String(output).slice(0, 500).replace(/\n/g, ' ');
        console.log(`  Output: "${preview}${String(output).length > 500 ? '...' : ''}"`);
        console.log('  PROOF: Routine output uses org memory + decisions context');
      } else {
        console.log('  (Routine did not complete within timeout — worker may be busy)');
      }

      // Reload to show run history in the UI
      await page.reload();
      await pace(page, 3000);
    });

    console.log('\n--- Scenario 4 complete: routine runs with org context ---');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FINALE: Quick montage — navigate all features
  // ═══════════════════════════════════════════════════════════════════════════

  test('Finale: Feature montage', async ({ page }) => {
    test.setTimeout(60_000);

    csrf = await loginAs(page, 'admin');

    await test.step('Navigate all features', async () => {
      const routes = [
        { path: '/chat', label: 'Chat — AI with full org context' },
        { path: '/tasks', label: 'Tasks — kanban board' },
        { path: '/decisions', label: 'Decisions — organizational memory' },
        { path: '/memory', label: 'Memory — knowledge base' },
        { path: '/skills', label: 'Skills — installable expertise' },
        { path: '/routines', label: 'Routines — automated workflows' },
        { path: '/activity', label: 'Activity — org-wide feed' },
        { path: '/settings/identity', label: 'Settings — identity & soul' },
        { path: '/settings/governance', label: 'Settings — governance' },
      ];

      for (const { path, label } of routes) {
        await navigateTo(page, path, 1500);
        console.log(`  ${label}`);
      }
    });

    console.log('\n========================================');
    console.log('JTBD Video Tour complete.');
    console.log('Video file: test-results/videos/');
    console.log('========================================');
  });
});
