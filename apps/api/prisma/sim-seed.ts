/**
 * Simulation seed — a multi-team org used by load tests, UI e2e, and manual
 * exploration. Deterministic (fixed faker seed) so runs are reproducible.
 *
 *   3 orgs:  hearth-sim (primary, ~40 users / 6 teams)
 *            rival-corp (tenant-isolation foil, 6 users / 2 teams)
 *            empty-org  (cold-start, no content)
 *   + sessions/messages, tasks across all statuses, memory across layers,
 *     decisions, routines, skills, integrations, governance policies, identities.
 *
 * Embeddings are left NULL here (Prisma can't write the `vector` type). To make
 * semantic-search assertions meaningful, run the app's embedding backfill with a
 * real LLM key, or call the memory/decision create routes for the rows you need
 * indexed. See the test plan §3.
 *
 * Run:  pnpm --filter @hearth/api sim-seed
 * Idempotent: no-ops if the primary org already has users.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();
faker.seed(20260609);

const PRIMARY_TEAMS = ['Engineering', 'Product', 'Design', 'Sales', 'Ops', 'Exec'];
const RIVAL_TEAMS = ['Rival Eng', 'Rival Sales'];
const TASK_STATUSES = [
  'auto_detected', 'backlog', 'planning', 'executing', 'review', 'done', 'failed', 'archived',
] as const;
const TASK_SOURCES = ['email', 'slack', 'meeting', 'manual', 'agent_proposed', 'chat_user'] as const;

// Volumes — tuned to exercise pagination/feed/queues without a slow seed.
const N = { sessions: 60, msgPerBusySession: 80, busySessions: 8, tasks: 150, memory: 300, decisions: 60, routines: 30, skills: 25 };

function pick<T>(arr: readonly T[]): T {
  return arr[faker.number.int({ min: 0, max: arr.length - 1 })];
}

async function main(): Promise<void> {
  const existing = await prisma.org.findUnique({ where: { slug: 'hearth-sim' } });
  if (existing) {
    const userCount = await prisma.user.count({ where: { team: { orgId: existing.id } } });
    if (userCount > 0) {
      console.log('sim-seed: hearth-sim already populated — skipping (drop the DB to reseed).');
      return;
    }
  }

  const passwordHash = await bcrypt.hash('changeme', 10);
  console.log('sim-seed: generating orgs, teams, users...');

  // ─── Orgs + teams ──────────────────────────────────────────────────────────
  const primaryOrg = await prisma.org.upsert({
    where: { slug: 'hearth-sim' }, update: {}, create: { name: 'Hearth Sim', slug: 'hearth-sim', plan: 'business' },
  });
  const rivalOrg = await prisma.org.upsert({
    where: { slug: 'rival-corp' }, update: {}, create: { name: 'Rival Corp', slug: 'rival-corp', plan: 'team' },
  });
  await prisma.org.upsert({
    where: { slug: 'empty-org' }, update: {}, create: { name: 'Empty Org', slug: 'empty-org', plan: 'free' },
  });

  const primaryTeams = await Promise.all(
    PRIMARY_TEAMS.map((name) => prisma.team.create({ data: { name, orgId: primaryOrg.id } })),
  );
  const rivalTeams = await Promise.all(
    RIVAL_TEAMS.map((name) => prisma.team.create({ data: { name, orgId: rivalOrg.id } })),
  );

  // ─── Users: 2 admin, 6 team_lead, 28 member, 4 viewer (primary) ─────────────
  type SeedUser = { id: string; teamId: string; orgId: string };
  const primaryUsers: SeedUser[] = [];
  const rolePlan: Array<[string, number]> = [['admin', 2], ['team_lead', 6], ['member', 28], ['viewer', 4]];
  let idx = 0;
  for (const [role, count] of rolePlan) {
    for (let i = 0; i < count; i++) {
      const team = primaryTeams[idx % primaryTeams.length];
      idx++;
      const name = faker.person.fullName();
      const u = await prisma.user.create({
        data: {
          email: `sim_${role}_${i}@hearth-sim.local`,
          name,
          role: role as never,
          authProvider: 'email',
          passwordHash,
          teamId: team.id,
        },
      });
      primaryUsers.push({ id: u.id, teamId: team.id, orgId: primaryOrg.id });
    }
  }

  // Named e2e fixture users — the identities the Playwright specs log in as
  // (see e2e/fixtures/test-helpers.ts USERS). Created IN the primary sim org so
  // every e2e login lands in the populated dataset (not an empty default org).
  const teamByName = new Map(primaryTeams.map((t, i) => [PRIMARY_TEAMS[i], t] as const));
  const FIXTURE_USERS: Array<{ email: string; name: string; role: string; team: string }> = [
    { email: 'admin@hearth.local', name: 'Admin', role: 'admin', team: 'Engineering' },
    { email: 'cto@hearth.local', name: 'CTO', role: 'admin', team: 'Engineering' },
    { email: 'eng-lead@hearth.local', name: 'Engineering Lead', role: 'team_lead', team: 'Engineering' },
    { email: 'product-lead@hearth.local', name: 'Product Lead', role: 'team_lead', team: 'Product' },
    { email: 'dev1@hearth.local', name: 'Developer One', role: 'member', team: 'Engineering' },
    { email: 'dev2@hearth.local', name: 'Developer Two', role: 'member', team: 'Engineering' },
    { email: 'pm1@hearth.local', name: 'Product Manager', role: 'member', team: 'Product' },
    { email: 'designer@hearth.local', name: 'Designer', role: 'member', team: 'Design' },
    { email: 'data-analyst@hearth.local', name: 'Data Analyst', role: 'member', team: 'Engineering' },
    { email: 'intern@hearth.local', name: 'Intern', role: 'viewer', team: 'Engineering' },
    { email: 'contractor@hearth.local', name: 'Contractor', role: 'viewer', team: 'Product' },
    { email: 'new-hire@hearth.local', name: 'New Hire', role: 'member', team: 'Engineering' },
  ];
  for (const f of FIXTURE_USERS) {
    const team = teamByName.get(f.team)!;
    const u = await prisma.user.create({
      data: { email: f.email, name: f.name, role: f.role as never, authProvider: 'email', passwordHash, teamId: team.id },
    });
    primaryUsers.push({ id: u.id, teamId: team.id, orgId: primaryOrg.id });
  }
  console.log(`sim-seed: + ${FIXTURE_USERS.length} named e2e fixture users in ${primaryOrg.slug}`);

  // Rival org: 6 users (1 admin + 5 members)
  const rivalUsers: SeedUser[] = [];
  for (let i = 0; i < 6; i++) {
    const team = rivalTeams[i % rivalTeams.length];
    const u = await prisma.user.create({
      data: {
        email: `rival_${i}@rival-corp.local`,
        name: faker.person.fullName(),
        role: (i === 0 ? 'admin' : 'member') as never,
        authProvider: 'email',
        passwordHash,
        teamId: team.id,
      },
    });
    rivalUsers.push({ id: u.id, teamId: team.id, orgId: rivalOrg.id });
  }

  // One orgless user (no team) — exercises requireOrg 400 paths.
  await prisma.user.create({
    data: { email: 'orphan@nowhere.local', name: 'No Team', role: 'member', authProvider: 'email', passwordHash },
  });

  console.log(`sim-seed: ${primaryUsers.length} primary + ${rivalUsers.length} rival + 1 orgless users`);

  // ─── Org SOUL identity ───────────────────────────────────────────────────────
  await prisma.agentIdentity.create({
    data: { orgId: primaryOrg.id, fileType: 'soul', source: 'template', content: '# Hearth Sim SOUL\nBe direct and action-oriented.' },
  });

  // ─── Integrations (encrypted-credential placeholders) ────────────────────────
  for (const provider of ['slack', 'notion', 'gcalendar', 'gmail']) {
    await prisma.integration.create({
      data: { orgId: primaryOrg.id, provider, config: { encryptedCredentials: 'sample', label: provider }, status: 'active', enabled: true },
    });
  }

  // ─── Chat sessions + messages ────────────────────────────────────────────────
  console.log('sim-seed: sessions + messages...');
  const sessionIds: string[] = [];
  for (let i = 0; i < N.sessions; i++) {
    const author = pick(primaryUsers);
    const s = await prisma.chatSession.create({
      data: {
        orgId: author.orgId,
        userId: author.id,
        title: faker.company.catchPhrase(),
        visibility: faker.datatype.boolean() ? 'org' : 'private',
        status: i % 20 === 0 ? 'archived' : 'active',
      },
    });
    sessionIds.push(s.id);
    const isBusy = i < N.busySessions;
    const msgCount = isBusy ? N.msgPerBusySession : faker.number.int({ min: 2, max: 12 });
    const messages: Prisma.ChatMessageCreateManyInput[] = [];
    for (let m = 0; m < msgCount; m++) {
      const isUser = m % 2 === 0;
      messages.push({
        orgId: author.orgId,
        sessionId: s.id,
        role: isUser ? 'user' : 'assistant',
        content: faker.lorem.sentences({ min: 1, max: 3 }),
        createdBy: isUser ? author.id : null,
      });
    }
    await prisma.chatMessage.createMany({ data: messages });
  }

  // ─── Tasks across all statuses ───────────────────────────────────────────────
  console.log('sim-seed: tasks...');
  const taskRows: Prisma.TaskCreateManyInput[] = [];
  for (let i = 0; i < N.tasks; i++) {
    const owner = pick(primaryUsers);
    taskRows.push({
      orgId: owner.orgId,
      userId: owner.id,
      title: faker.hacker.phrase().slice(0, 120),
      description: faker.lorem.sentence(),
      status: pick(TASK_STATUSES) as never,
      source: pick(TASK_SOURCES) as never,
      priority: faker.number.int({ min: 0, max: 10 }),
    });
  }
  await prisma.task.createMany({ data: taskRows });

  // ─── Memory across org/team/user layers (PII sprinkled for compliance tests) ──
  console.log('sim-seed: memory...');
  const memRows: Prisma.MemoryEntryCreateManyInput[] = [];
  for (let i = 0; i < N.memory; i++) {
    const owner = pick(primaryUsers);
    const layer = pick(['org', 'team', 'user'] as const);
    const withPii = i % 25 === 0;
    memRows.push({
      orgId: owner.orgId,
      teamId: layer === 'team' ? owner.teamId : null,
      userId: layer === 'user' ? owner.id : null,
      layer,
      content: withPii ? `Contact SSN 345-67-${1000 + i} for ${faker.person.fullName()}` : faker.lorem.sentence(),
      source: 'sim-seed',
    });
  }
  await prisma.memoryEntry.createMany({ data: memRows });

  // ─── Decisions ───────────────────────────────────────────────────────────────
  console.log('sim-seed: decisions...');
  const decRows: Prisma.DecisionCreateManyInput[] = [];
  for (let i = 0; i < N.decisions; i++) {
    const owner = pick(primaryUsers);
    decRows.push({
      orgId: owner.orgId,
      teamId: owner.teamId,
      createdById: owner.id,
      title: faker.company.buzzPhrase(),
      reasoning: faker.lorem.paragraph(),
      domain: pick(['engineering', 'product', 'design', 'ops']),
      scope: pick(['org', 'team', 'personal'] as const) as never,
      confidence: pick(['low', 'medium', 'high'] as const) as never,
      sensitivity: i % 15 === 0 ? 'restricted' : 'normal',
    });
  }
  await prisma.decision.createMany({ data: decRows });

  // ─── Routines ────────────────────────────────────────────────────────────────
  console.log('sim-seed: routines...');
  for (let i = 0; i < N.routines; i++) {
    const owner = pick(primaryUsers);
    const scope = pick(['personal', 'team', 'org'] as const);
    await prisma.routine.create({
      data: {
        userId: owner.id,
        orgId: scope === 'org' ? owner.orgId : null,
        teamId: scope === 'team' ? owner.teamId : null,
        scope: scope as never,
        name: `${faker.hacker.verb()} ${faker.hacker.noun()}`,
        prompt: faker.lorem.sentence(),
        schedule: i % 5 === 0 ? '0 0 31 2 *' : i % 3 === 0 ? null : '0 9 * * 1-5',
        delivery: { channels: ['in_app'] },
        enabled: i % 7 !== 0,
      },
    });
  }

  // ─── Skills across scopes/statuses ───────────────────────────────────────────
  console.log('sim-seed: skills...');
  const scopes = ['personal', 'team', 'org'] as const;
  const statuses = ['draft', 'pending_review', 'published', 'deprecated'] as const;
  for (let i = 0; i < N.skills; i++) {
    const author = pick(primaryUsers);
    const scope = scopes[i % scopes.length];
    await prisma.skill.create({
      data: {
        orgId: author.orgId,
        authorId: author.id,
        name: `sim-skill-${i}`,
        description: faker.lorem.sentence(),
        content: `---\nname: sim-skill-${i}\ndescription: ${faker.lorem.words(4)}\n---\n${faker.lorem.paragraph()}`,
        scope: scope as never,
        teamId: scope === 'team' ? author.teamId : null,
        status: statuses[i % statuses.length] as never,
        requiredIntegrations: [],
        requiredCapabilities: [],
      },
    });
  }

  // ─── Governance policies at each enforcement level ───────────────────────────
  const admin = primaryUsers[0];
  await prisma.governancePolicy.createMany({
    data: [
      { orgId: primaryOrg.id, createdBy: admin.id, name: 'No secrets to LLM', ruleType: 'keyword', ruleConfig: { keywords: ['api_key', 'AWS_SECRET', 'BEGIN RSA PRIVATE KEY'], matchMode: 'any' }, severity: 'critical', enforcement: 'block' },
      { orgId: primaryOrg.id, createdBy: admin.id, name: 'Flag competitor mentions', ruleType: 'keyword', ruleConfig: { keywords: ['CompetitorX'], matchMode: 'any' }, severity: 'warning', enforcement: 'warn' },
      { orgId: primaryOrg.id, createdBy: admin.id, name: 'Monitor SSNs', ruleType: 'regex', ruleConfig: { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: '' }, severity: 'info', enforcement: 'monitor' },
    ],
  });

  console.log('sim-seed: done.');
}

main()
  .catch((e) => {
    console.error('sim-seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
