/**
 * Video Tour — Guided walkthrough of every Hearth feature.
 *
 * Run with:
 *   npx playwright test --config=playwright-video.config.ts
 *
 * Output: test-results/videos/
 */
import { test, expect } from '@playwright/test';
import { API, loginAs, apiGet, apiPost, apiPatch, apiDelete, uniqueId } from './fixtures/test-helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Hearth Platform Video Tour', () => {
  test('Full feature walkthrough with synthetic data', async ({ page }) => {
    test.setTimeout(300_000); // 5 minutes

    // ═══════════════════════════════════════════════════════════════════
    // ACT 1: Login
    // ═══════════════════════════════════════════════════════════════════

    await test.step('1. Login page', async () => {
      await page.goto('/#/login');
      await page.waitForTimeout(1500);
      await page.fill('input[type="email"]', 'admin@hearth.local');
      await page.waitForTimeout(500);
      await page.fill('input[type="password"]', 'changeme');
      await page.waitForTimeout(500);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
      console.log('Logged in as admin');
    });

    const cookies = await page.context().cookies();
    const csrf = cookies.find(c => c.name === 'hearth.csrf')?.value ?? '';

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2: Chat — create session, send messages
    // ═══════════════════════════════════════════════════════════════════

    await test.step('2. Chat — browse existing sessions', async () => {
      await page.goto('/#/chat');
      await page.waitForTimeout(2000);

      // Click through a few existing sessions if visible
      const sessionLinks = page.locator('[class*="cursor-pointer"], [class*="hover:bg"]');
      const count = await sessionLinks.count();
      if (count > 0) {
        await sessionLinks.first().click();
        await page.waitForTimeout(1500);
      }
      console.log(`Chat page — ${count} sessions visible`);
    });

    await test.step('3. Chat — create new session and send a message', async () => {
      // Create session via API (faster, avoids UI timing issues)
      const session = await apiPost(page, csrf, '/chat/sessions', {
        title: 'Video Tour Demo Session',
      });
      const sessionId = session.body.data?.id;

      if (sessionId) {
        await page.goto(`/#/chat/${sessionId}`);
        await page.waitForTimeout(2000);

        // Find and type in the message input
        const input = page.locator('textarea, input[type="text"]').last();
        if (await input.isVisible().catch(() => false)) {
          await input.fill('What are our coding standards and deployment process?');
          await page.waitForTimeout(1000);
          // Send message
          await input.press('Enter');
          await page.waitForTimeout(5000); // Wait for agent response to start streaming
        }
        console.log('Sent message in chat session');
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 3: Tasks — kanban board with tasks
    // ═══════════════════════════════════════════════════════════════════

    await test.step('4. Tasks — kanban board overview', async () => {
      await page.goto('/#/tasks');
      await page.waitForTimeout(2500);

      // Scroll to see all columns
      await page.mouse.wheel(300, 0);
      await page.waitForTimeout(1000);
      await page.mouse.wheel(-300, 0);
      await page.waitForTimeout(1000);
      console.log('Tasks kanban board shown');
    });

    await test.step('5. Tasks — create a new task', async () => {
      const newBtn = page.getByRole('button', { name: /new task/i });
      if (await newBtn.isVisible().catch(() => false)) {
        await newBtn.click();
        await page.waitForTimeout(800);

        const input = page.locator('input[placeholder*="title" i]').first();
        if (await input.isVisible().catch(() => false)) {
          await input.fill('Demo: Implement user preferences API');
          await page.waitForTimeout(500);
          await input.press('Enter');
          await page.waitForTimeout(1500);
        }
      }
      console.log('Created task via UI');
    });

    await test.step('6. Tasks — open task detail panel', async () => {
      // Click any task card
      const taskCard = page.locator('text=Review Q3').first();
      if (await taskCard.isVisible().catch(() => false)) {
        await taskCard.click();
        await page.waitForTimeout(1500);

        // Click through tabs
        for (const tab of ['Overview', 'Execution', 'Comments', 'Subtasks']) {
          const tabBtn = page.locator(`button:has-text("${tab}")`);
          if (await tabBtn.isVisible().catch(() => false)) {
            await tabBtn.click();
            await page.waitForTimeout(800);
          }
        }
      }
      console.log('Task detail panel shown');
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 4: Memory — organizational knowledge base
    // ═══════════════════════════════════════════════════════════════════

    await test.step('7. Memory — browse org knowledge', async () => {
      await page.goto('/#/memory');
      await page.waitForTimeout(2000);

      // Click through layer tabs
      for (const layer of ['Organization', 'Team', 'Personal']) {
        const pill = page.locator(`button:has-text("${layer}")`).first();
        if (await pill.isVisible().catch(() => false)) {
          await pill.click();
          await page.waitForTimeout(1000);
        }
      }
      console.log('Memory layers browsed');
    });

    await test.step('8. Memory — search for knowledge', async () => {
      const searchInput = page.getByPlaceholder(/search/i).first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('deployment');
        await page.waitForTimeout(500);

        const searchBtn = page.getByRole('button', { name: /search/i });
        if (await searchBtn.isVisible().catch(() => false)) {
          await searchBtn.click();
          await page.waitForTimeout(2000);
        }
      }
      console.log('Memory search executed');
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 5: Decisions — decision intelligence graph
    // ═══════════════════════════════════════════════════════════════════

    await test.step('9. Decisions — timeline view', async () => {
      await page.goto('/#/decisions');
      await page.waitForTimeout(2500);

      // Scroll through timeline
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(1000);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(1000);
      console.log('Decision timeline shown');
    });

    await test.step('10. Decisions — switch tabs and filter', async () => {
      // Switch to different tabs
      for (const tab of ['Patterns', 'Principles', 'Graph', 'Timeline']) {
        const tabBtn = page.locator(`button:has-text("${tab}")`).first();
        if (await tabBtn.isVisible().catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(1500);
        }
      }

      // Filter by domain
      const select = page.locator('select').first();
      if (await select.isVisible().catch(() => false)) {
        await select.selectOption('engineering');
        await page.waitForTimeout(1000);
        await select.selectOption('');
        await page.waitForTimeout(500);
      }
      console.log('Decision tabs and filters explored');
    });

    await test.step('11. Decisions — click to view detail', async () => {
      const firstDecision = page.locator('[class*="cursor-pointer"]').first();
      if (await firstDecision.isVisible().catch(() => false)) {
        await firstDecision.click();
        await page.waitForTimeout(2000);
      }
      console.log('Decision detail viewed');
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 6: Skills — browse and install
    // ═══════════════════════════════════════════════════════════════════

    await test.step('12. Skills — browse catalog', async () => {
      await page.goto('/#/skills');
      await page.waitForTimeout(2000);

      // Switch tabs
      for (const tab of ['Installed', 'Recommended', 'All']) {
        const tabBtn = page.locator(`button:has-text("${tab}")`).first();
        if (await tabBtn.isVisible().catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(1000);
        }
      }
      console.log('Skills catalog browsed');
    });

    await test.step('13. Skills — search and click detail', async () => {
      const searchInput = page.getByPlaceholder(/search/i).first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('code review');
        await page.waitForTimeout(1500);
        await searchInput.clear();
        await page.waitForTimeout(500);
      }

      // Click a skill to view detail
      const skillRow = page.locator('[class*="cursor-pointer"], [class*="hover:bg"]').first();
      if (await skillRow.isVisible().catch(() => false)) {
        await skillRow.click();
        await page.waitForTimeout(1500);
      }
      console.log('Skill detail viewed');
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 7: Routines — automation engine
    // ═══════════════════════════════════════════════════════════════════

    await test.step('14. Routines — list and scope tabs', async () => {
      await page.goto('/#/routines');
      await page.waitForTimeout(2000);

      for (const tab of ['Team', 'Organization', 'My Routines']) {
        const tabBtn = page.locator(`button:has-text("${tab}")`).first();
        if (await tabBtn.isVisible().catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(1000);
        }
      }
      console.log('Routine scopes browsed');
    });

    await test.step('15. Routines — click to view detail', async () => {
      const routineRow = page.locator('[class*="cursor-pointer"]').first();
      if (await routineRow.isVisible().catch(() => false)) {
        await routineRow.click();
        await page.waitForTimeout(2000);
      }
      console.log('Routine detail viewed');
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 8: Activity — org-wide feed
    // ═══════════════════════════════════════════════════════════════════

    await test.step('16. Activity — browse feed and filters', async () => {
      await page.goto('/#/activity');
      await page.waitForTimeout(2000);

      // Click filter pills
      for (const filter of ['Tasks', 'Decisions', 'Skills', 'All']) {
        const pill = page.locator(`button:has-text("${filter}")`).first();
        if (await pill.isVisible().catch(() => false)) {
          await pill.click();
          await page.waitForTimeout(800);
        }
      }

      // Scroll to see more events
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(1000);
      console.log('Activity feed browsed');
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 9: Settings — admin dashboard
    // ═══════════════════════════════════════════════════════════════════

    await test.step('17. Settings — profile and identity', async () => {
      await page.goto('/#/settings/profile');
      await page.waitForTimeout(1500);

      // Navigate to Soul & Identity
      const identityTab = page.locator('button:has-text("Soul"), a:has-text("Soul")').first();
      if (await identityTab.isVisible().catch(() => false)) {
        await identityTab.click();
        await page.waitForTimeout(1500);
      }
      console.log('Profile and identity shown');
    });

    await test.step('18. Settings — admin tabs tour', async () => {
      const adminTabs = ['users', 'teams', 'integrations', 'llm', 'governance', 'compliance'];
      for (const tab of adminTabs) {
        await page.goto(`/#/settings/${tab}`);
        await page.waitForTimeout(1500);
        console.log(`  Settings/${tab} loaded`);
      }
    });

    await test.step('19. Settings — governance policies', async () => {
      await page.goto('/#/settings/governance');
      await page.waitForTimeout(2000);

      // Scroll to see policies
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(1000);
      console.log('Governance settings shown');
    });

    // ═══════════════════════════════════════════════════════════════════
    // ACT 10: Final overview — sidebar navigation
    // ═══════════════════════════════════════════════════════════════════

    await test.step('20. Final — rapid navigation tour', async () => {
      const pages = ['chat', 'tasks', 'decisions', 'memory', 'skills', 'routines', 'activity'];
      for (const p of pages) {
        await page.goto(`/#/${p}`);
        await page.waitForTimeout(1200);
      }
      console.log('Full navigation tour complete');
    });
  });
});
