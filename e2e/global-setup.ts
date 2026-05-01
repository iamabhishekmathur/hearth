/**
 * Global setup: seeds the database with 100-person org simulation data.
 * Runs before all test suites via Playwright project dependency.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  API,
  AUTH_DIR,
  USERS,
  loginAs,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
} from './fixtures/test-helpers';

const SEED_MARKER = path.join(__dirname, '..', 'test-results', '.seed-complete');

test('Seed comprehensive test data', async ({ page }) => {
  test.setTimeout(180_000); // 3 minutes for seeding

  // ── Step 1: Login as admin ──────────────────────────────────────────────────
  const csrf = await loginAs(page, 'admin');
  console.log(`Logged in as admin, CSRF length: ${csrf.length}`);

  // Check if data already exists — skip full seed if so
  const existCheck = await apiGet(page, '/decisions?limit=1');
  if (existCheck.status === 200 && (existCheck.body.data || []).length > 0) {
    console.log('Data already seeded (decisions exist), skipping');
    fs.mkdirSync(path.dirname(SEED_MARKER), { recursive: true });
    fs.writeFileSync(SEED_MARKER, new Date().toISOString());
    return;
  }

  // ── Step 2: Create Teams ────────────────────────────────────────────────────
  await test.step('Create teams', async () => {
    for (const teamName of ['Engineering', 'Product', 'Design']) {
      const res = await apiPost(page, csrf, '/admin/teams', { name: teamName });
      console.log(`Team ${teamName}: ${res.status}`);
    }
  });

  // ── Step 3: Register Users (with rate-limit awareness) ──────────────────────
  let currentCsrf = csrf;
  await test.step('Register users', async () => {
    const entries = Object.entries(USERS).filter(([k]) => k !== 'admin');
    // Auth rate limit is 5/min per IP. Batch in groups of 4 with 61s pauses.
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && i % 4 === 0) {
        console.log('  Waiting 61s for rate limit window to reset...');
        await page.waitForTimeout(61_000);
      }
      const [, creds] = entries[i];
      const res = await page.request.post(`${API}/auth/register`, {
        data: { email: creds.email, password: creds.password, name: creds.name },
      });
      const status = res.status();
      console.log(`  Register ${creds.email}: ${status}`);
    }

    // Re-login after long wait to refresh session+CSRF
    console.log('  Re-logging in to refresh session...');
    currentCsrf = await loginAs(page, 'admin');
    console.log(`  Refreshed CSRF length: ${currentCsrf.length}`);
  });

  // ── Step 4: Assign Roles & Teams ────────────────────────────────────────────
  await test.step('Assign roles and teams', async () => {
    const teamsRes = await apiGet(page, '/admin/teams');
    console.log(`  GET /admin/teams: ${teamsRes.status}`);
    const teams = teamsRes.body.data || [];
    const teamMap: Record<string, string> = {};
    for (const t of teams) {
      teamMap[t.name] = t.id;
    }

    const usersRes = await apiGet(page, '/admin/users');
    console.log(`  GET /admin/users: ${usersRes.status}`);
    const users = usersRes.body.data || [];
    console.log(`  Found ${users.length} users, ${teams.length} teams`);

    for (const [key, creds] of Object.entries(USERS)) {
      if (key === 'admin') continue;
      const user = users.find((u: { email: string }) => u.email === creds.email);
      if (!user) continue;
      const teamId = teamMap[creds.team];
      if (!teamId) continue;
      await apiPut(page, currentCsrf, `/admin/users/${user.id}`, { role: creds.role, teamId });
    }
    console.log('Roles/teams assigned');
  });

  // ── Step 5: Identity Documents ──────────────────────────────────────────────
  await test.step('Create identity documents', async () => {
    await apiPut(page, currentCsrf, '/identity/org/soul', {
      content: `# Organization SOUL.md
We are a product-focused engineering org. We value clarity, shipping fast, and helping each other.
Default to TypeScript. Always write tests. Follow REST conventions. Never store secrets in code.`,
    });
    await apiPut(page, currentCsrf, '/identity/user/soul', {
      content: 'I prefer concise, technical responses. Use code examples. Skip pleasantries.',
    });
    await apiPut(page, currentCsrf, '/identity/user/identity', {
      content: '10 years of backend experience. Expert in distributed systems.',
    });
    console.log('Identity documents set');
  });

  // ── Step 6: Memory Entries ──────────────────────────────────────────────────
  await test.step('Create memory entries', async () => {
    const memories = [
      { layer: 'org', content: 'Tech stack: TypeScript, React, Node.js, PostgreSQL, Redis, Prisma ORM, BullMQ.', source: 'architecture' },
      { layer: 'org', content: 'Deployment: PR > CI > staging > canary > production. All deploys require passing tests.', source: 'devops' },
      { layer: 'org', content: 'Code review requires at least one approval. Focus on correctness, not style.', source: 'handbook' },
      { layer: 'org', content: 'Trunk-based development. Feature branches < 3 days.', source: 'git-workflow' },
      { layer: 'org', content: 'Security: no secrets in code, rotate API keys quarterly, use env vars.', source: 'security' },
      { layer: 'org', content: 'PostgreSQL for primary storage. Redis for caching only.', source: 'architecture' },
      { layer: 'org', content: 'Async-first communication. Use Slack threads. Document decisions in Hearth.', source: 'handbook' },
      { layer: 'org', content: 'Daily standup 9am, sprint planning Monday, retro Friday.', source: 'calendar' },
      { layer: 'team', content: 'Sprint process: 2-week sprints, planning Monday, demo Friday.', source: 'eng-process' },
      { layer: 'team', content: 'Code review SLA: respond within 4 hours.', source: 'eng-sla' },
      { layer: 'team', content: 'Testing: units for services, e2e for critical flows, >80% coverage.', source: 'eng-standards' },
      { layer: 'user', content: 'Debug: read error message > check logs > add breakpoints.', source: 'notes' },
      { layer: 'user', content: 'React: functional components + hooks. Never class components.', source: 'preferences' },
    ];
    let count = 0;
    for (const mem of memories) {
      const res = await apiPost(page, currentCsrf, '/memory', mem);
      if (res.status === 201) count++;
    }
    console.log(`Memory entries: ${count}`);
  });

  // ── Step 7: Chat Sessions ──────────────────────────────────────────────────
  await test.step('Create chat sessions', async () => {
    const titles = [
      'API Architecture Discussion', 'Database Migration', 'Code Review Standards',
      'Performance Optimization', 'Security Findings', 'Sprint Planning',
    ];
    let count = 0;
    for (const title of titles) {
      const res = await apiPost(page, currentCsrf, '/chat/sessions', { title });
      if (res.status === 201) count++;
    }
    console.log(`Chat sessions: ${count}`);
  });

  // ── Step 8: Tasks ──────────────────────────────────────────────────────────
  await test.step('Create tasks', async () => {
    const tasks = [
      { title: 'Review Q3 roadmap', source: 'email' },
      { title: 'Update deployment scripts', source: 'email' },
      { title: 'Fix flaky CI test', source: 'slack' },
      { title: 'Schedule team offsite', source: 'meeting' },
      { title: 'Implement user preferences API', source: 'manual', priority: 3 },
      { title: 'Add dark mode support', source: 'manual', priority: 2 },
      { title: 'Write API documentation', source: 'manual', priority: 1 },
    ];
    let count = 0;
    for (const t of tasks) {
      const res = await apiPost(page, currentCsrf, '/tasks', {
        title: t.title, source: t.source, priority: t.priority ?? 0,
        description: `Seeded: ${t.title}`,
      });
      if (res.status === 201) count++;
    }
    console.log(`Tasks: ${count}`);
  });

  // ── Step 9: Decisions ──────────────────────────────────────────────────────
  await test.step('Create decisions', async () => {
    const decisions = [
      { title: 'Use PostgreSQL for primary storage', reasoning: 'Mature, pgvector, strong ecosystem', domain: 'engineering' },
      { title: 'Adopt TypeScript full-stack', reasoning: 'Type safety, shared types, IDE support', domain: 'engineering' },
      { title: 'Use BullMQ for job queues', reasoning: 'Redis-backed, reliable, good monitoring', domain: 'engineering' },
      { title: 'REST over GraphQL', reasoning: 'Simpler, cacheable, team experienced', domain: 'engineering' },
      { title: 'Chat-first UX', reasoning: 'Primary AI interaction pattern', domain: 'product' },
      { title: 'Kanban for tasks', reasoning: 'Visual workflow, familiar pattern', domain: 'product' },
      { title: 'Decision graph feature', reasoning: 'Track and connect org decisions', domain: 'product' },
      { title: 'Tailwind CSS for styling', reasoning: 'Utility-first, fast, maintainable', domain: 'design' },
      { title: 'Docker Compose for dev', reasoning: 'Simple setup, matches production', domain: 'operations' },
      { title: 'Open-source the platform', reasoning: 'Community, trust, contributions', domain: 'strategy' },
      { title: 'Per-seat pricing', reasoning: 'Predictable revenue, scales with org', domain: 'finance' },
    ];
    let count = 0;
    for (const d of decisions) {
      const res = await apiPost(page, currentCsrf, '/decisions', {
        title: d.title, reasoning: d.reasoning, domain: d.domain,
        alternatives: [], scope: 'org', confidence: 'high',
      });
      if (res.status === 201) count++;
    }
    console.log(`Decisions: ${count}`);
  });

  // ── Step 10: Skills ─────────────────────────────────────────────────────────
  await test.step('Create skills', async () => {
    const skills = [
      { name: 'code-review-best-practices', content: '---\nname: code-review-best-practices\ndescription: Effective code review guidelines\n---\n\nCheck correctness, readability, then performance.' },
      { name: 'api-design-guidelines', content: '---\nname: api-design-guidelines\ndescription: REST API standards\n---\n\nVersion APIs, validate with Zod, use proper status codes.' },
      { name: 'incident-response', content: '---\nname: incident-response\ndescription: Production incident handling\n---\n\nAcknowledge, assess, communicate, fix, post-mortem.' },
    ];
    let count = 0;
    for (const s of skills) {
      const res = await apiPost(page, currentCsrf, '/skills', {
        name: s.name, description: s.name, content: s.content, scope: 'org',
      });
      if (res.status === 201) count++;
      else console.log(`  Skill "${s.name}": ${res.status} - ${JSON.stringify(res.body).slice(0, 100)}`);
    }
    console.log(`Skills: ${count}`);
  });

  // ── Step 11: Governance Policies ────────────────────────────────────────────
  await test.step('Create governance policies', async () => {
    await apiPut(page, currentCsrf, '/admin/governance/settings', {
      enabled: true, checkUserMessages: true, checkAiResponses: false,
      notifyAdmins: true, monitoringBanner: true,
    });
    const policies = [
      { name: 'No PII in chat', category: 'data_privacy', severity: 'critical', ruleType: 'keyword',
        ruleConfig: { keywords: ['SSN', 'social security'], matchMode: 'any', caseSensitive: false }, enforcement: 'block' },
      { name: 'API key detection', category: 'security', severity: 'critical', ruleType: 'regex',
        ruleConfig: { pattern: 'sk-[a-zA-Z0-9]{20,}', flags: '' }, enforcement: 'block' },
    ];
    let count = 0;
    for (const p of policies) {
      const res = await apiPost(page, currentCsrf, '/admin/governance/policies', p);
      if (res.status === 201) count++;
    }
    console.log(`Governance policies: ${count}`);
  });

  // ── Step 12: Routines ──────────────────────────────────────────────────────
  await test.step('Create routines', async () => {
    const routines = [
      { name: 'Daily standup summary', prompt: 'Summarize team activity.', schedule: '0 9 * * 1-5' },
      { name: 'Weekly metrics digest', prompt: 'Generate weekly metrics.', schedule: '0 8 * * 1' },
    ];
    let count = 0;
    for (const r of routines) {
      const res = await apiPost(page, currentCsrf, '/routines', { ...r, delivery: { channels: ['in_app'] } });
      if (res.status === 201) count++;
    }
    console.log(`Routines: ${count}`);
  });

  // ── Step 13: Meetings ──────────────────────────────────────────────────────
  await test.step('Create meeting ingestions', async () => {
    const res = await apiPost(page, currentCsrf, '/meetings/ingest', {
      provider: 'granola',
      title: 'Sprint Planning',
      participants: ['admin@hearth.local'],
      meetingDate: new Date(Date.now() - 7 * 86400000).toISOString(),
      transcript: 'Discussed sprint goals. Focus on decision graph feature.',
      summary: 'Sprint planning session.',
    });
    console.log(`Meeting ingestion: ${res.status}`);
  });

  // ── Mark complete ──────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(SEED_MARKER), { recursive: true });
  fs.writeFileSync(SEED_MARKER, new Date().toISOString());
  console.log('Seed complete!');
});
