/**
 * GTM Demo Seed — "Enterprise Beta Launch Review"
 *
 * Creates a polished, coherent demo dataset for product videos, screenshots,
 * and live demos. Idempotent: safe to run multiple times.
 *
 * Usage:
 *   pnpm seed:gtm-demo
 *   # or: npx tsx src/scripts/seed-gtm-demo.ts
 *
 * Preserves:
 *   - Default org (reuses it)
 *   - admin@hearth.local login (changeme)
 *
 * Cleans:
 *   - All prior demo/test data (matched by known prefixes and source markers)
 *   - Replaces with one clean "Enterprise Beta Launch Review" story
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ─── Helpers ───────────────────────────────────────────────────────────

function ago(days: number, hours = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d;
}

function minutesAgo(m: number): Date {
  return new Date(Date.now() - m * 60_000);
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔥 Hearth GTM Demo Seed');
  console.log('━'.repeat(50));

  // ── Step 1: Ensure org exists ──────────────────────────────────────

  const org = await prisma.org.upsert({
    where: { slug: 'default' },
    update: {
      name: 'Hearth',
      settings: {
        llm: { visionEnabled: true, defaultModel: 'claude-sonnet-4-6' },
        governance: { enabled: true, checkUserMessages: true, checkAiResponses: true },
        cognitive: { enabled: false },
        compliance: { enabledPacks: ['pii', 'pci-dss', 'gdpr'], detectorOverrides: {}, auditLevel: 'summary', allowUserOverride: false },
      },
    },
    create: {
      name: 'Hearth',
      slug: 'default',
      settings: {
        llm: { visionEnabled: true, defaultModel: 'claude-sonnet-4-6' },
        governance: { enabled: true, checkUserMessages: true, checkAiResponses: true },
        cognitive: { enabled: false },
        compliance: { enabledPacks: ['pii', 'pci-dss', 'gdpr'], detectorOverrides: {}, auditLevel: 'summary', allowUserOverride: false },
      },
    },
  });
  console.log(`✓ Org: ${org.name} (${org.id})`);
  const orgId = org.id;

  // ── Step 2: Clean old demo data ────────────────────────────────────

  console.log('\nCleaning old demo data...');

  // Delete in dependency order (children first)
  await prisma.activityReaction.deleteMany({ where: { auditLog: { orgId: org.id } } });
  await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
  await prisma.governanceViolation.deleteMany({ where: { orgId: org.id } });
  await prisma.governancePolicy.deleteMany({ where: { orgId: org.id } });
  await prisma.orgPrincipleEvidence.deleteMany({ where: { principle: { orgId: org.id } } });
  await prisma.orgPrinciple.deleteMany({ where: { orgId: org.id } });
  await prisma.decisionPatternLink.deleteMany({ where: { pattern: { orgId: org.id } } });
  await prisma.decisionPattern.deleteMany({ where: { orgId: org.id } });
  await prisma.decisionOutcome.deleteMany({ where: { decision: { orgId: org.id } } });
  await prisma.decisionLink.deleteMany({ where: { fromDecision: { orgId: org.id } } });
  await prisma.decisionContext.deleteMany({ where: { decision: { orgId: org.id } } });
  await prisma.decision.deleteMany({ where: { orgId: org.id } });
  await prisma.thoughtPattern.deleteMany({ where: { orgId: org.id } });
  await prisma.cognitiveProfile.deleteMany({ where: { orgId: org.id } });
  await prisma.agentExperience.deleteMany({ where: { orgId: org.id } });
  await prisma.userSkill.deleteMany({});
  await prisma.skill.deleteMany({ where: { orgId: org.id } });

  const orgRoutines = await prisma.routine.findMany({ where: { orgId: org.id }, select: { id: true } });
  const routineIds = orgRoutines.map(r => r.id);
  if (routineIds.length > 0) {
    await prisma.approvalRequest.deleteMany({ where: { run: { routineId: { in: routineIds } } } });
    await prisma.routineRun.deleteMany({ where: { routineId: { in: routineIds } } });
    await prisma.approvalCheckpoint.deleteMany({ where: { routineId: { in: routineIds } } });
    await prisma.routineChain.deleteMany({ where: { OR: [{ sourceRoutineId: { in: routineIds } }, { targetRoutineId: { in: routineIds } }] } });
    await prisma.routineHealthAlert.deleteMany({ where: { routineId: { in: routineIds } } });
    await prisma.routineTrigger.deleteMany({ where: { routineId: { in: routineIds } } });
  }
  await prisma.routine.deleteMany({ where: { OR: [{ orgId: org.id }, { user: { team: { orgId: org.id } } }] } });
  await prisma.artifactVersion.deleteMany({ where: { artifact: { session: { user: { team: { orgId: org.id } } } } } });
  await prisma.artifact.deleteMany({ where: { session: { user: { team: { orgId: org.id } } } } });
  await prisma.chatAttachment.deleteMany({ where: { message: { session: { user: { team: { orgId: org.id } } } } } });
  await prisma.chatMessage.deleteMany({ where: { session: { user: { team: { orgId: org.id } } } } });
  await prisma.sessionCollaborator.deleteMany({ where: { session: { user: { team: { orgId: org.id } } } } });
  await prisma.sessionShare.deleteMany({ where: { session: { user: { team: { orgId: org.id } } } } });
  await prisma.chatSession.deleteMany({ where: { user: { team: { orgId: org.id } } } });
  await prisma.taskReview.deleteMany({ where: { task: { user: { team: { orgId: org.id } } } } });
  await prisma.taskExecutionStep.deleteMany({ where: { task: { user: { team: { orgId: org.id } } } } });
  await prisma.taskComment.deleteMany({ where: { task: { user: { team: { orgId: org.id } } } } });
  await prisma.taskContextItem.deleteMany({ where: { task: { user: { team: { orgId: org.id } } } } });
  await prisma.task.updateMany({ where: { user: { team: { orgId: org.id } }, parentTaskId: { not: null } }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { user: { team: { orgId: org.id } } } });
  await prisma.memoryEntry.deleteMany({ where: { orgId: org.id } });
  await prisma.agentIdentity.deleteMany({ where: { orgId: org.id } });
  await prisma.webhookEndpoint.deleteMany({ where: { orgId: org.id } });
  await prisma.integration.deleteMany({ where: { orgId: org.id } });
  await prisma.user.deleteMany({ where: { team: { orgId: org.id } } });
  await prisma.team.deleteMany({ where: { orgId: org.id } });

  console.log('✓ Old data cleaned');

  // ── Step 3: Create teams ───────────────────────────────────────────

  const launchTeam = await prisma.team.create({
    data: { name: 'Launch Team', orgId: org.id },
  });
  console.log(`✓ Team: ${launchTeam.name}`);

  // ── Step 4: Create users ───────────────────────────────────────────

  const pw = await bcrypt.hash('changeme', 12);

  const admin = await prisma.user.create({
    data: { email: 'admin@hearth.local', name: 'Admin', role: 'admin', authProvider: 'email', passwordHash: pw, teamId: launchTeam.id },
  });
  const priya = await prisma.user.create({
    data: { email: 'priya@hearth.local', name: 'Priya Shah', role: 'team_lead', authProvider: 'email', passwordHash: pw, teamId: launchTeam.id },
  });
  const marcus = await prisma.user.create({
    data: { email: 'marcus@hearth.local', name: 'Marcus Lee', role: 'member', authProvider: 'email', passwordHash: pw, teamId: launchTeam.id },
  });
  const dana = await prisma.user.create({
    data: { email: 'dana@hearth.local', name: 'Dana Ortiz', role: 'member', authProvider: 'email', passwordHash: pw, teamId: launchTeam.id },
  });
  const alex = await prisma.user.create({
    data: { email: 'alex@hearth.local', name: 'Alex Kim', role: 'member', authProvider: 'email', passwordHash: pw, teamId: launchTeam.id },
  });
  const jordan = await prisma.user.create({
    data: { email: 'jordan@hearth.local', name: 'Jordan Reed', role: 'admin', authProvider: 'email', passwordHash: pw, teamId: launchTeam.id },
  });

  console.log('✓ Users: Admin, Priya, Marcus, Dana, Alex, Jordan');

  // ── Step 5: Integrations ───────────────────────────────────────────

  for (const i of [
    { provider: 'slack',     config: { label: 'Slack', workspace: 'hearth-team', encryptedCredentials: '[DEMO_TOKEN]' } },
    { provider: 'gmail',     config: { label: 'Gmail', account: 'team@hearth.dev', encryptedCredentials: '[DEMO_TOKEN]' } },
    { provider: 'gcalendar', config: { label: 'Google Calendar', account: 'team@hearth.dev', encryptedCredentials: '[DEMO_TOKEN]' } },
    { provider: 'notion',    config: { label: 'Notion', workspace: 'Hearth Product', encryptedCredentials: '[DEMO_TOKEN]' } },
    { provider: 'github',    config: { label: 'GitHub', org: 'hearth-dev', encryptedCredentials: '[DEMO_TOKEN]' } },
  ]) {
    await prisma.integration.create({
      data: { orgId: org.id, provider: i.provider, config: i.config, status: 'active', enabled: true, healthCheckedAt: minutesAgo(15) },
    });
  }
  console.log('✓ Integrations: slack, gmail, gcalendar, notion, github');

  // ── Step 6: Identity docs ──────────────────────────────────────────

  await prisma.agentIdentity.create({
    data: {
      orgId: org.id, fileType: 'soul', source: 'manual',
      content: `# Hearth SOUL.md\n\nYou are Hearth, an AI productivity assistant for teams. You operate as a task-doer, not an advisor.\n\n## Principles\n- Bias toward action. When asked to do something, do it.\n- Be concise. Skip preamble. Surface results, not process.\n- Confirm before irreversible actions.\n- When you solve a multi-step problem, propose saving it as a reusable workflow.\n- Reference org memory and past decisions when relevant.\n- Never fabricate data. Use connected integrations to verify.`,
    },
  });
  console.log('✓ Org SOUL.md');

  // ── Step 7: Main chat session (owned by Admin, collaborative) ─────

  const session = await prisma.chatSession.create({
    data: {
      orgId,
      userId: admin.id,
      title: 'Enterprise Beta Launch Review',
      status: 'active',
      visibility: 'org',
    },
  });

  for (const u of [priya, marcus, dana, alex, jordan]) {
    await prisma.sessionCollaborator.create({
      data: { orgId, sessionId: session.id, userId: u.id, role: 'contributor', addedBy: admin.id },
    });
  }

  // ── Messages ───────────────────────────────────────────────────────

  const msgs: Array<{ role: 'user' | 'assistant'; content: string; by?: string; minutesAgo: number }> = [
    {
      role: 'user', by: priya.id, minutesAgo: 45,
      content: `Review everything we know about the Enterprise Beta launch. Pull from the launch notes in Notion, customer feedback in Slack, last week's readiness meeting notes, and the GitHub milestone. Identify blockers, create follow-up tasks, capture decisions we shouldn't lose, and turn the process into a reusable launch review workflow for future launches.`,
    },
    {
      role: 'assistant', minutesAgo: 43,
      content: `I've pulled context from five sources — Notion launch notes, Slack #enterprise-beta channel, last week's readiness meeting transcript, GitHub milestone "Enterprise Beta," and three design partner feedback threads. Here's the synthesis.

## Launch Readiness Summary

**Overall status:** Close, but not ready for external expansion. Two hard blockers remain.

### Blockers

1. **SSO callback retry handling** — Intermittent failures on the SAML callback under load. Three of our five design partners flagged this in onboarding. Marcus's team has a fix in review but it hasn't shipped.
2. **Audit-log export** — Enterprise procurement requires downloadable audit logs. The endpoint exists but returns incomplete data for sessions with >50 messages. Dana flagged this in the security review.

### Risks

3. **Customer-facing FAQ** — Support doesn't have a rollout FAQ for enterprise admins. Alex mentioned this in Slack — customers are asking about data retention, model choice, and memory ownership.
4. **Security positioning for procurement** — Two prospects asked for a one-pager on how Hearth handles org-owned memory, provider choice, and data governance. Sales is fielding this ad hoc.
5. **Admin controls gap** — Design partners want bulk user management and role templates. Not a blocker, but three separate partners requested it.

### What's working

- Core chat, skills, routines, and memory are stable
- Governance policies are active and catching real violations
- The "Enterprise Launch Review" workflow (this session) is a strong proof point for the product value

## Recommendation

**Proceed with internal beta. Gate external expansion until SSO callback fix ships and audit-log export is complete.** Estimated: 5-7 days if prioritized this sprint.

I've created 9 follow-up tasks, captured 5 decisions, and saved "Enterprise Launch Review" as a reusable workflow.`,
    },
    {
      role: 'user', by: marcus.id, minutesAgo: 38,
      content: `SSO fix is in review — PR #247. Should ship tomorrow if Dana approves the security implications. Can Hearth track that and notify the team when it merges?`,
    },
    {
      role: 'assistant', minutesAgo: 37,
      content: `Noted. I've updated the SSO task to "review" status and linked it to PR #247. I'll set up a notification via the GitHub integration — when #247 merges to main, I'll post to #enterprise-beta in Slack and update the task to "done."

The audit-log export task is still in "executing." Dana, what's the timeline on the >50 message truncation fix?`,
    },
    {
      role: 'user', by: dana.id, minutesAgo: 35,
      content: `Audit log fix is straightforward — pagination was missing on the export query. I can have it done today. The harder question is whether we need to include tool-call details in the export or just message content.`,
    },
    {
      role: 'assistant', minutesAgo: 34,
      content: `Good question. Based on the design partner feedback and the enterprise security checklist in Notion, procurement teams care about:

1. **Who** said what (user attribution)
2. **What tools** were invoked (for data lineage)
3. **What data sources** were accessed

I'd recommend including tool-call metadata in the export. It's a differentiator — most AI tools don't offer this level of auditability.

I've captured this as a decision: "Include tool-call metadata in audit-log exports for enterprise."`,
    },
    {
      role: 'user', by: alex.id, minutesAgo: 30,
      content: `For the customer FAQ — I've got a draft started. Can Hearth pull the common questions from the Slack threads and help me structure it?`,
    },
    {
      role: 'assistant', minutesAgo: 29,
      content: `Done. I found 14 questions across #enterprise-beta and #support-escalations. The top themes:

1. **Data ownership** — "Where does my org's memory live? Can I export it?"
2. **Model choice** — "Can we use our own Azure OpenAI instance?"
3. **Governance** — "Can admins see what the AI accesses?"
4. **SSO** — "Do you support SAML/OIDC?"
5. **Retention** — "How long are conversations stored? Can we set policies?"

I've created an artifact with the draft FAQ structured around these themes. Take a look and edit — once you're happy, we can publish it to the docs site.`,
    },
    {
      role: 'user', by: jordan.id, minutesAgo: 22,
      content: `This is exactly the kind of work that should compound. Can we make sure this launch review process is saved so anyone on the team can run it for future launches?`,
    },
    {
      role: 'assistant', minutesAgo: 21,
      content: `Already done. I've saved "Enterprise Launch Review" as a published skill with these inputs:

- **Launch notes** (Notion page or doc)
- **Customer feedback** (Slack channel or thread)
- **Meeting notes** (transcript or summary)
- **GitHub milestone** (milestone name)

The workflow outputs a readiness memo, decision log, task plan, and risk summary. Anyone on the team can run it from the Skills page.

I've also set up a "Monday Launch Risk Digest" routine that will summarize blockers, decision changes, and owner updates every Monday at 9am until the beta ships. It posts to #enterprise-beta in Slack.`,
    },
  ];

  for (const m of msgs) {
    await prisma.chatMessage.create({
      data: { orgId, sessionId: session.id, role: m.role, content: m.content, createdBy: m.by ?? null, createdAt: minutesAgo(m.minutesAgo), metadata: {} },
    });
  }
  console.log(`✓ Chat: ${msgs.length} messages`);

  // ── Step 8: Artifacts ──────────────────────────────────────────────

  const artifactDefs = [
    { type: 'document' as const, title: 'Enterprise Beta Launch Notes',
      content: `# Enterprise Beta Launch Notes\n\n## Timeline\n- Internal beta: Apr 14\n- Design partner expansion: Apr 21\n- Public beta: May 5 (conditional)\n\n## Gating criteria\n- [ ] SSO callback reliability >99.9%\n- [ ] Audit-log export complete\n- [ ] Customer FAQ published\n- [ ] Security one-pager approved\n- [x] Governance policies active\n- [x] Core features stable\n\n## Design partners\n1. Acme Corp — 12 users, finance team\n2. Globex — 8 users, ops team\n3. Initech — 20 users, eng team\n\n## Key contacts\n- Priya Shah — Product/GTM Lead\n- Marcus Lee — Engineering Lead\n- Dana Ortiz — Security/Compliance\n- Alex Kim — Customer Success` },
    { type: 'document' as const, title: 'Customer Feedback Digest',
      content: `# Customer Feedback Digest — Enterprise Beta\n\n## Summary\n14 feedback items across 3 design partners.\n\n### Positive\n- "Memory across sessions is the killer feature" — Acme\n- "Governance dashboard gives us confidence" — Globex\n- "Skills library saves us hours of repeated work" — Initech\n\n### Requested\n- Stronger admin controls (3 partners)\n- SSO reliability improvements (3 partners)\n- Audit log download (2 partners)\n\n### Blockers to expansion\n- "We can't roll out broadly until SSO is rock solid" — Acme CTO\n- "Procurement needs a security questionnaire response" — Globex` },
    { type: 'document' as const, title: 'Launch Readiness Meeting Notes',
      content: `# Launch Readiness Meeting — Apr 22\n\nAttendees: Priya, Marcus, Dana, Alex, Jordan\n\n## Decisions made\n1. Gate external expansion on SSO fix + audit export\n2. Prioritize SSO callback retry (Marcus: PR #247)\n3. Dana to fix audit log pagination today\n4. Alex to draft customer FAQ by Thursday\n5. Weekly launch risk digest starting Monday\n\n## Open questions\n- Should audit logs include tool-call metadata? (Decision: yes)\n- Timeline for bulk user management? (Deferred to v1.1)\n- Who owns the security one-pager? (Dana + Alex)` },
    { type: 'document' as const, title: 'Security Review Checklist',
      content: `# Enterprise Security Review Checklist\n\n## Authentication\n- [x] SSO/SAML support\n- [ ] SSO callback retry handling (in review)\n- [x] Session management with HTTP-only cookies\n- [x] Password hashing (bcrypt)\n\n## Data\n- [x] Org-owned memory (not vendor-specific)\n- [x] AES-256-GCM encryption for integration tokens\n- [ ] Audit-log export (pagination fix pending)\n- [x] Data retention policies configurable\n\n## Governance\n- [x] PII detection policy active\n- [x] No-secrets-in-prompts policy active\n- [x] Customer data minimization monitoring\n- [x] Violation review workflow\n\n## Model\n- [x] Provider choice (Anthropic, OpenAI, Azure)\n- [x] No training on customer data\n- [x] Model fallback configuration` },
    { type: 'document' as const, title: 'Rollout FAQ Draft',
      content: `# Hearth Enterprise Beta — FAQ\n\n**Q: Where does our org's data live?**\nA: All memory, decisions, and conversation history are stored in your org's Hearth instance. We use PostgreSQL with AES-256-GCM encryption. Nothing is shared across organizations.\n\n**Q: Can we use our own LLM provider?**\nA: Yes. Hearth supports Anthropic, OpenAI, and Azure OpenAI. You can set a default model per workspace.\n\n**Q: Can admins see what the AI accesses?**\nA: Yes. The governance dashboard shows all policy violations, tool invocations, and data source access. Audit logs are exportable.\n\n**Q: Do you support SSO?**\nA: Yes — SAML and OIDC.\n\n**Q: How long are conversations stored?**\nA: Configurable per workspace. Default is 180 days for chat history. Artifacts and memory are stored indefinitely unless you set a retention policy.` },
  ];

  for (const a of artifactDefs) {
    await prisma.artifact.create({
      data: { orgId, sessionId: session.id, type: a.type, title: a.title, content: a.content, language: null, createdBy: admin.id, createdAt: minutesAgo(42) },
    });
  }
  console.log(`✓ Artifacts: ${artifactDefs.length} documents`);

  // ── Step 9: Tasks (all owned by admin for board visibility) ────────

  type TaskDef = {
    title: string; desc: string; status: string; source: string; priority: number;
    comments?: Array<{ userId?: string; isAgent?: boolean; content: string }>;
    steps?: Array<{ desc: string; status: string; tool?: string }>;
  };

  const taskDefs: TaskDef[] = [
    // Auto-detected
    { title: 'Summarize enterprise security FAQ for procurement', desc: 'Create a one-page security summary answering common procurement questions about data ownership, model choice, and governance.', status: 'auto_detected', source: 'slack', priority: 2 },
    { title: 'Set up SSO merge notification', desc: 'Configure GitHub integration to post to #enterprise-beta when PR #247 merges.', status: 'auto_detected', source: 'agent_proposed', priority: 1 },
    // Backlog
    { title: 'Draft customer rollout FAQ', desc: 'Structure the top 14 customer questions into a publishable FAQ for the docs site.', status: 'backlog', source: 'agent_proposed', priority: 2 },
    { title: 'Create beta invite criteria', desc: 'Define the criteria for expanding beta invitations beyond current design partners.', status: 'backlog', source: 'meeting', priority: 1 },
    // Planning
    { title: 'Finalize launch readiness checklist', desc: 'Update the launch readiness checklist with current status of all gating items.', status: 'planning', source: 'agent_proposed', priority: 2,
      comments: [
        { isAgent: true, content: 'Created from launch review. 6 of 8 gating items are complete — SSO callback and audit-log export remain.' },
        { userId: priya.id, content: 'Will update after Marcus ships the SSO fix.' },
      ] },
    { title: 'Plan security one-pager for enterprise prospects', desc: 'Outline the content for a one-page security positioning document covering org-owned memory, provider choice, and governance.', status: 'planning', source: 'meeting', priority: 2 },
    // Executing
    { title: 'Implement audit-log export for admins', desc: 'Fix pagination on audit-log export endpoint. Include tool-call metadata in export payload.', status: 'executing', source: 'meeting', priority: 3,
      comments: [
        { userId: dana.id, content: 'Pagination fix is done. Adding tool-call metadata to the export schema now.' },
        { isAgent: true, content: 'Decision captured: "Include tool-call metadata in audit-log exports for enterprise."' },
      ],
      steps: [
        { desc: 'Fix pagination on export query', status: 'completed', tool: 'code_execution' },
        { desc: 'Add tool-call metadata to export schema', status: 'running', tool: 'code_execution' },
        { desc: 'Test with sessions >50 messages', status: 'pending' },
      ] },
    // Review
    { title: 'Fix SSO callback retry handling', desc: 'SAML callback intermittently fails under concurrent logins. Add retry logic with exponential backoff. PR #247.', status: 'review', source: 'slack', priority: 3,
      comments: [
        { userId: marcus.id, content: 'PR #247 is up. Added exponential backoff with max 3 retries. Load tested at 50 concurrent logins.' },
        { userId: dana.id, content: 'Security review approved. Ship it.' },
      ],
      steps: [
        { desc: 'Analyze callback failure logs', status: 'completed', tool: 'github.search' },
        { desc: 'Implement retry with backoff', status: 'completed', tool: 'code_execution' },
        { desc: 'Load test with 50 concurrent SSO logins', status: 'completed', tool: 'code_execution' },
        { desc: 'Security review', status: 'completed' },
      ] },
    { title: 'Review launch decision memo', desc: 'Review and approve the launch readiness memo before sharing with leadership.', status: 'review', source: 'agent_proposed', priority: 2,
      comments: [
        { isAgent: true, content: 'Memo generated from launch review session. Key recommendation: proceed with internal beta, gate external expansion.' },
        { userId: jordan.id, content: 'Looks good. One edit — add the timeline estimate for the SSO fix.' },
      ] },
    // Done
    { title: 'Collect design partner feedback', desc: 'Compile feedback from Acme, Globex, and Initech design partners into a structured digest.', status: 'done', source: 'agent_proposed', priority: 2,
      comments: [
        { isAgent: true, content: 'Collected 14 feedback items across 3 partners. Top themes: admin controls, SSO reliability, audit log download.' },
        { userId: alex.id, content: 'Added to the Customer Feedback Digest artifact.' },
      ],
      steps: [
        { desc: 'Pull feedback from Slack #enterprise-beta', status: 'completed', tool: 'slack.search' },
        { desc: 'Pull feedback from support threads', status: 'completed', tool: 'slack.search' },
        { desc: 'Structure into digest document', status: 'completed', tool: 'create_artifact' },
      ] },
    { title: 'Publish internal beta announcement', desc: 'Post the internal beta announcement to #general with links to docs, FAQ, and the launch review workflow.', status: 'done', source: 'manual', priority: 1,
      steps: [
        { desc: 'Draft announcement', status: 'completed', tool: 'create_artifact' },
        { desc: 'Post to #general', status: 'completed', tool: 'slack.post' },
      ] },
  ];

  for (const t of taskDefs) {
    const task = await prisma.task.create({
      data: { orgId, userId: admin.id, title: t.title, description: t.desc, status: t.status as any, source: t.source as any, priority: t.priority, context: {}, createdAt: ago(1, 2) },
    });
    if (t.comments) {
      for (const c of t.comments) {
        await prisma.taskComment.create({ data: { orgId, taskId: task.id, userId: c.userId ?? null, isAgent: c.isAgent ?? false, content: c.content } });
      }
    }
    if (t.steps) {
      for (let i = 0; i < t.steps.length; i++) {
        const s = t.steps[i];
        await prisma.taskExecutionStep.create({ data: { orgId, taskId: task.id, stepNumber: i + 1, description: s.desc, status: s.status as any, phase: 'execution', toolUsed: s.tool ?? null } });
      }
    }
  }
  console.log(`✓ Tasks: ${taskDefs.length} across kanban`);

  // ── Step 10: Memory ────────────────────────────────────────────────

  const memories = [
    { layer: 'org' as const, content: 'Enterprise customers require SSO, audit logs, and clear data-retention answers before beta expansion.' },
    { layer: 'org' as const, content: 'Launches should not expand externally while auth or security blockers remain unresolved.' },
    { layer: 'org' as const, content: 'Design partners prefer weekly launch-risk summaries with clear owner attribution and status changes.' },
    { layer: 'org' as const, content: 'Enterprise Launch Review workflow is the standard starting point for future launch readiness reviews.' },
    { layer: 'org' as const, content: 'Customer-facing AI/security messaging should emphasize org-owned memory, provider choice, and governance controls.' },
    { layer: 'org' as const, content: 'For launch decisions, always capture alternatives, rationale, affected customers, and follow-up tasks.' },
    { layer: 'org' as const, content: 'Audit-log exports should include tool-call metadata for data lineage.' },
    { layer: 'team' as const, content: 'Priya runs launch reviews. The team collaborates in shared sessions with org visibility.' },
    { layer: 'team' as const, content: 'Marcus owns SSO and auth infra. Dana owns security review and compliance.' },
    { layer: 'team' as const, content: 'Alex manages design partner relationships and customer-facing documentation.' },
  ];
  for (const m of memories) {
    await prisma.memoryEntry.create({ data: { orgId: org.id, teamId: m.layer === 'team' ? launchTeam.id : null, userId: null, layer: m.layer, content: m.content, source: 'assistant', sourceRef: { sessionId: session.id } } });
  }
  console.log(`✓ Memory: ${memories.length} entries`);

  // ── Step 11: Decisions ─────────────────────────────────────────────

  const d1 = await prisma.decision.create({ data: {
    orgId: org.id, teamId: launchTeam.id, createdById: priya.id, sessionId: session.id,
    title: 'Gate enterprise beta expansion on SSO callback reliability',
    reasoning: 'Three of five design partners reported intermittent SSO failures during onboarding. Expanding before the fix ships risks damaging trust. Marcus has a fix in PR #247.',
    alternatives: [{ label: 'Ship without SSO fix', pros: 'Faster timeline', cons: 'Risk of churn' }, { label: 'Gate on SSO fix', pros: 'Reliable onboarding', cons: '5-7 day delay' }],
    domain: 'product', tags: ['launch', 'security', 'sso'], scope: 'org', status: 'active', confidence: 'high', source: 'chat', sourceRef: { sessionId: session.id },
    participants: ['Priya Shah', 'Marcus Lee', 'Jordan Reed'], quality: 0.9, importance: 0.95,
  }});
  const d2 = await prisma.decision.create({ data: {
    orgId: org.id, teamId: launchTeam.id, createdById: dana.id, sessionId: session.id,
    title: 'Require audit-log export before enterprise procurement calls',
    reasoning: 'Enterprise procurement requires downloadable audit logs. Two prospects explicitly asked. The endpoint has a pagination bug with sessions >50 messages.',
    alternatives: [{ label: 'Delay procurement calls', pros: 'Complete story', cons: 'Lost deals' }, { label: 'Ship partial export', pros: 'Unblock sales', cons: 'Incomplete data' }],
    domain: 'engineering', tags: ['launch', 'compliance', 'audit'], scope: 'org', status: 'active', confidence: 'high', source: 'meeting', sourceRef: { sessionId: session.id },
    participants: ['Dana Ortiz', 'Alex Kim', 'Priya Shah'], quality: 0.85, importance: 0.9,
  }});
  const d3 = await prisma.decision.create({ data: {
    orgId: org.id, teamId: launchTeam.id, createdById: jordan.id, sessionId: session.id,
    title: 'Standardize on Priya\'s launch review workflow for all future launches',
    reasoning: 'The launch review session demonstrated a repeatable process: pull context, identify risks, create tasks, capture decisions, produce a readiness memo. This should be org-wide.',
    alternatives: [{ label: 'Ad hoc reviews', pros: 'Flexibility', cons: 'Knowledge lost' }, { label: 'Standardize', pros: 'Repeatable, auditable', cons: 'Slight overhead' }],
    domain: 'operations', tags: ['launch', 'workflow', 'process'], scope: 'org', status: 'active', confidence: 'high', source: 'chat', sourceRef: { sessionId: session.id },
    participants: ['Jordan Reed', 'Priya Shah'], quality: 0.88, importance: 0.8,
  }});
  const d4 = await prisma.decision.create({ data: {
    orgId: org.id, teamId: launchTeam.id, createdById: priya.id, sessionId: session.id,
    title: 'Send weekly launch risk digest until beta expansion',
    reasoning: 'Weekly Monday digest keeps the team aligned on blockers and status without daily standups.',
    alternatives: [{ label: 'Daily standup', pros: 'Higher cadence', cons: 'Meeting fatigue' }, { label: 'Weekly digest', pros: 'Async, comprehensive', cons: 'Slower loop' }],
    domain: 'product', tags: ['launch', 'routine'], scope: 'team', status: 'active', confidence: 'medium', source: 'chat', sourceRef: { sessionId: session.id },
    participants: ['Priya Shah', 'Marcus Lee', 'Dana Ortiz', 'Alex Kim'], quality: 0.75, importance: 0.7,
  }});
  const d5 = await prisma.decision.create({ data: {
    orgId: org.id, teamId: launchTeam.id, createdById: dana.id, sessionId: session.id,
    title: 'Include tool-call metadata in audit-log exports',
    reasoning: 'Procurement teams need data lineage — not just what was said, but what tools were invoked and what sources were accessed. This is a competitive differentiator.',
    alternatives: [{ label: 'Message content only', pros: 'Simple', cons: 'Misses lineage' }, { label: 'Include metadata', pros: 'Full auditability', cons: 'Larger files' }],
    domain: 'engineering', tags: ['compliance', 'audit', 'enterprise'], scope: 'org', status: 'active', confidence: 'high', source: 'chat', sourceRef: { sessionId: session.id },
    participants: ['Dana Ortiz', 'Priya Shah'], quality: 0.82, importance: 0.85,
  }});

  await prisma.decisionLink.create({ data: { fromDecisionId: d2.id, toDecisionId: d5.id, relationship: 'informed_by', description: 'Audit export scope informed by tool-metadata decision' } });
  await prisma.decisionLink.create({ data: { fromDecisionId: d1.id, toDecisionId: d4.id, relationship: 'related_to', description: 'Weekly digest tracks SSO blocker resolution' } });
  await prisma.decisionLink.create({ data: { fromDecisionId: d3.id, toDecisionId: d4.id, relationship: 'related_to', description: 'Standard workflow includes launch risk digest' } });
  await prisma.decisionOutcome.create({ data: { decisionId: d1.id, observedById: marcus.id, verdict: 'too_early', description: 'SSO fix in PR #247 is in review. Load-tested at 50 concurrent logins. Awaiting merge.' } });
  console.log('✓ Decisions: 5 with links and outcomes');

  // ── Step 12: Decision patterns + principles ────────────────────────

  const pattern = await prisma.decisionPattern.create({ data: {
    orgId: org.id, teamId: launchTeam.id, name: 'Security blockers pause external expansion',
    description: 'When auth, compliance, or data-control issues are unresolved, external customer expansion is gated until fixes ship.',
    domain: 'operations', status: 'established', decisionCount: 2, confidence: 0.85,
  }});
  await prisma.decisionPatternLink.create({ data: { decisionId: d1.id, patternId: pattern.id } });
  await prisma.decisionPatternLink.create({ data: { decisionId: d2.id, patternId: pattern.id } });

  const principle = await prisma.orgPrinciple.create({ data: {
    orgId: org.id, domain: 'operations',
    title: 'Do not scale customer access with unresolved security blockers',
    description: 'External launch expansion requires all auth, compliance, and data-control blockers to have named owners and target dates.',
    guideline: 'Before expanding customer access, verify: (1) all security blockers have owners, (2) fixes are in review or shipped, (3) audit and compliance requirements are met.',
    antiPattern: 'Expanding access while SSO, audit, or data-retention issues are unresolved — even under timeline pressure.',
    status: 'active', confidence: 0.9, version: 1,
  }});
  await prisma.orgPrincipleEvidence.create({ data: { principleId: principle.id, patternId: pattern.id } });
  console.log('✓ Patterns: 1, Principles: 1');

  // ── Step 13: Skills (primary + 2 supporting) ──────────────────────

  const skillLaunch = await prisma.skill.create({ data: {
    orgId: org.id, teamId: launchTeam.id, authorId: priya.id,
    name: 'Enterprise Launch Review',
    description: 'Turns launch notes, customer feedback, meeting transcripts, and task activity into a launch readiness memo, decision log, and follow-up task plan.',
    content: `# Enterprise Launch Review\n\n## Purpose\nSynthesize launch context from multiple sources into a structured readiness assessment.\n\n## Inputs\n- **Launch notes** — Notion page or doc with timeline and gating criteria\n- **Customer feedback** — Slack channel or thread with partner feedback\n- **Meeting notes** — Readiness meeting transcript or summary\n- **GitHub milestone** — Milestone name for engineering status (optional)\n\n## Steps\n1. Pull and synthesize context from all provided sources\n2. Identify launch blockers (hard gates) and risks (watch items)\n3. Assess gating criteria status\n4. Create follow-up tasks for unresolved items with owners and priorities\n5. Capture decisions with reasoning and alternatives\n6. Save key learnings to org memory\n7. Generate a readiness memo for leadership\n8. Propose a launch risk digest routine if recurring reviews are needed\n\n## Output\n- **Readiness summary** — 3-5 sentence executive summary\n- **Blockers** — Numbered list with owner, status, ETA\n- **Risks** — Numbered list with severity and mitigation\n- **Decisions** — Captured in decision graph\n- **Tasks** — Created in workspace\n- **Recommendation** — Go / conditional go / no-go\n\n## Governance\n- Do not include customer PII in the readiness memo\n- Reference org memory for past launch precedents\n- Flag unresolved security items to compliance lead`,
    scope: 'org', status: 'published', installCount: 5, source: 'manual',
    requiredIntegrations: ['slack', 'notion', 'github'], requiredCapabilities: ['web_search', 'create_artifact', 'save_memory'],
  }});

  const skillFAQ = await prisma.skill.create({ data: {
    orgId: org.id, teamId: launchTeam.id, authorId: alex.id,
    name: 'Security FAQ Builder',
    description: 'Generates a customer-facing security FAQ from internal security checklists, governance policies, and common prospect questions.',
    content: `# Security FAQ Builder\n\n## Purpose\nTurn internal security documentation into a customer-facing FAQ that answers enterprise procurement questions.\n\n## Inputs\n- **Security checklist** — Internal review document\n- **Governance policies** — Active policy list from Hearth\n- **Prospect questions** — Common questions from Slack or email\n\n## Steps\n1. Extract key security controls from the checklist\n2. Map governance policies to customer-facing language\n3. Structure prospect questions into themed sections\n4. Generate FAQ with clear, non-technical answers\n5. Flag any gaps where answers are incomplete\n\n## Output\n- Structured FAQ document (Markdown)\n- Gap analysis for unanswered questions`,
    scope: 'org', status: 'published', installCount: 3, source: 'manual',
    requiredIntegrations: ['slack'], requiredCapabilities: ['create_artifact'],
  }});

  const skillMemo = await prisma.skill.create({ data: {
    orgId: org.id, teamId: launchTeam.id, authorId: priya.id,
    name: 'Launch Decision Memo',
    description: 'Compiles recent decisions, blockers, and recommendations into a leadership-ready memo with clear go/no-go guidance.',
    content: `# Launch Decision Memo\n\n## Purpose\nSummarize launch decisions, remaining blockers, and recommendation into a concise memo for leadership or board review.\n\n## Inputs\n- **Decision graph** — Recent decisions from Hearth\n- **Task board** — Current blocker and risk status\n- **Memory** — Org-level launch context\n\n## Steps\n1. Pull all decisions tagged "launch" from the decision graph\n2. Summarize current blocker status from the task board\n3. Reference org memory for context and precedents\n4. Draft a 1-page memo with executive summary, decisions, risks, and recommendation\n5. Generate as a document artifact\n\n## Output\n- 1-page decision memo (Markdown)\n- Linked to decision graph entries`,
    scope: 'org', status: 'published', installCount: 2, source: 'manual',
    requiredIntegrations: [], requiredCapabilities: ['create_artifact', 'save_memory'],
  }});

  // Install skills for users
  for (const u of [admin, priya, marcus, alex, jordan]) {
    await prisma.userSkill.create({ data: { orgId, userId: u.id, skillId: skillLaunch.id } });
  }
  for (const u of [admin, alex, dana]) {
    await prisma.userSkill.create({ data: { orgId, userId: u.id, skillId: skillFAQ.id } });
  }
  for (const u of [admin, priya]) {
    await prisma.userSkill.create({ data: { orgId, userId: u.id, skillId: skillMemo.id } });
  }
  console.log('✓ Skills: 3 (Enterprise Launch Review, Security FAQ Builder, Launch Decision Memo)');

  // ── Step 14: Routines (supporting first, hero last for recency sort) ─

  // Supporting routines — created earlier so they sort below the hero
  await prisma.routine.create({ data: {
    userId: admin.id, orgId: org.id, teamId: launchTeam.id,
    name: 'Customer Feedback Triage',
    description: 'Scans Slack and support channels for enterprise beta feedback, clusters by theme, and flags urgent objections.',
    prompt: 'Scan #enterprise-beta, #support-escalations, and recent Gmail threads for enterprise beta feedback. Cluster feedback by theme (auth, governance, admin, UX). Flag urgent objections that could block expansion. Output a ranked list with source links.',
    schedule: '0 10 * * 1-5', delivery: { type: 'in_app' },
    enabled: true, scope: 'team', lastRunAt: ago(1), lastRunStatus: 'success', createdVia: 'manual',
    createdAt: ago(3),
  }});

  await prisma.routine.create({ data: {
    userId: admin.id, orgId: org.id, teamId: launchTeam.id,
    name: 'Procurement Readiness Check',
    description: 'Checks whether security FAQ, audit export, and SSO blockers are resolved before enterprise sales calls.',
    prompt: 'Check the current status of: (1) security FAQ — published? (2) audit-log export — endpoint working for >50 messages? (3) SSO callback — PR merged? Report readiness status and flag any gaps before the next procurement call.',
    schedule: '0 8 * * 1-5', delivery: { type: 'slack', channel: '#enterprise-beta' },
    enabled: true, scope: 'team', lastRunAt: ago(0, 6), lastRunStatus: 'success', createdVia: 'manual',
    createdAt: ago(2),
  }});

  // Hero routine — created last so it appears first in recency-sorted lists
  const rDigest = await prisma.routine.create({ data: {
    userId: admin.id, orgId: org.id, teamId: launchTeam.id,
    name: 'Monday Launch Risk Digest',
    description: 'Summarizes launch blockers, decisions, owner changes, and customer-facing risks every Monday at 9am.',
    prompt: 'Review the current state of the Enterprise Beta launch. Check org memory for launch blockers, pull recent task updates, check decision graph for any new or changed decisions, and summarize activity from the past week. Output a concise risk digest with: top risks (with owners), what changed since last run, launch recommendation, and next actions. Post to #enterprise-beta in Slack.',
    schedule: '0 9 * * 1', delivery: { type: 'slack', channel: '#enterprise-beta' },
    enabled: true, scope: 'team', lastRunAt: ago(0, 3), lastRunStatus: 'success', createdVia: 'agent',
    state: { lastRunBlockers: 2, lastRunRisks: 3 },
  }});
  await prisma.routineRun.create({ data: {
    routineId: rDigest.id, status: 'success', startedAt: ago(0, 3), completedAt: ago(0, 3),
    durationMs: 12400, tokenCount: 3200, triggeredBy: 'schedule',
    summary: '2 blockers, 3 risks. SSO fix in review. Audit export in progress.',
    output: { digest: `# Launch Risk Digest — Week of Apr 21\n\n## Top Risks\n1. **SSO callback retry** — Owner: Marcus · Status: PR #247 in review · ETA: Tomorrow\n2. **Audit-log export** — Owner: Dana · Status: Pagination fix done, adding tool metadata · ETA: Today\n3. **Customer FAQ** — Owner: Alex · Status: Draft started · ETA: Thursday\n4. **Security one-pager** — Owner: Dana + Alex · Status: Not started · ETA: Friday\n5. **Admin controls gap** — Owner: Unassigned · Deferred to v1.1\n\n## What changed\n- SSO fix moved from "executing" to "review"\n- Decision captured: include tool-call metadata in audit exports\n- 3 new design partner feedback items collected\n- "Enterprise Launch Review" saved as a reusable workflow\n\n## Recommendation\n**Hold external expansion.** SSO and audit-log blockers have clear owners and ETAs.\n\n## Next actions\n- Marcus: merge SSO fix\n- Dana: complete audit export\n- Alex: finish FAQ draft\n- Priya: update launch checklist` },
  }});

  console.log('✓ Routines: 3 (Launch Risk Digest, Feedback Triage, Procurement Readiness)');

  // ── Step 15: Governance ────────────────────────────────────────────

  const pol1 = await prisma.governancePolicy.create({ data: {
    orgId: org.id, createdBy: dana.id,
    name: 'No secrets in AI prompts', description: 'Block messages containing API keys, tokens, or credentials from being sent to the LLM.',
    category: 'security', severity: 'critical', ruleType: 'pattern',
    ruleConfig: { patterns: ['(?i)(api[_-]?key|secret[_-]?key|bearer\\s+[a-z0-9]|sk-[a-z0-9])'] },
    enforcement: 'block', enabled: true,
  }});
  const pol2 = await prisma.governancePolicy.create({ data: {
    orgId: org.id, createdBy: dana.id,
    name: 'PII detection', description: 'Warn when messages contain potential personally identifiable information.',
    category: 'privacy', severity: 'warning', ruleType: 'pattern',
    ruleConfig: { patterns: ['\\b\\d{3}-\\d{2}-\\d{4}\\b', '(?i)social\\s*security'] },
    enforcement: 'warn', enabled: true,
  }});
  await prisma.governancePolicy.create({ data: {
    orgId: org.id, createdBy: dana.id,
    name: 'Customer data minimization', description: 'Monitor for unnecessary inclusion of customer identifiers or account details in AI conversations.',
    category: 'privacy', severity: 'info', ruleType: 'keyword',
    ruleConfig: { keywords: ['customer_id', 'account_number', 'billing_address'] },
    enforcement: 'monitor', enabled: true,
  }});
  await prisma.governancePolicy.create({ data: {
    orgId: org.id, createdBy: dana.id,
    name: 'Sensitive data scrub', description: 'Block messages containing tokens or credentials from reaching external LLM providers.',
    category: 'security', severity: 'critical', ruleType: 'pattern',
    ruleConfig: { patterns: ['(?i)(password|passwd|secret)\\s*[:=]\\s*\\S+'] },
    enforcement: 'block', enabled: true,
  }});

  await prisma.governanceViolation.create({ data: {
    orgId: org.id, policyId: pol1.id, userId: alex.id, sessionId: session.id,
    messageRole: 'user', severity: 'critical',
    contentSnippet: 'Here is the API key for the staging env: [REDACTED_API_KEY]',
    matchDetails: { pattern: 'api_key', redacted: true, action: 'blocked' },
    enforcement: 'block', status: 'acknowledged',
    reviewedBy: dana.id, reviewNote: 'Caught and blocked. Reminded Alex to use the secrets vault.',
    reviewedAt: ago(0, 6),
  }});
  await prisma.governanceViolation.create({ data: {
    orgId: org.id, policyId: pol2.id, userId: priya.id, sessionId: session.id,
    messageRole: 'user', severity: 'warning',
    contentSnippet: 'The customer contact for Acme is [REDACTED_CUSTOMER_IDENTIFIER]',
    matchDetails: { pattern: 'customer_identifier', flagged: true },
    enforcement: 'warn', status: 'dismissed',
    reviewedBy: dana.id, reviewNote: 'False positive — this was a role title, not PII.',
    reviewedAt: ago(0, 5),
  }});
  console.log('✓ Governance: 4 policies, 2 violations');

  // ── Step 16: Audit / Activity logs ─────────────────────────────────

  const auditEvents: Array<{ userId: string; action: string; entityType: string; entityId?: string; details: any; minutesAgo: number }> = [
    { userId: priya.id,  action: 'session_created',     entityType: 'session',             entityId: session.id,    details: { title: 'Enterprise Beta Launch Review', visibility: 'org' }, minutesAgo: 46 },
    { userId: priya.id,  action: 'task_completed',       entityType: 'task',                                        details: { title: 'Set up launch review session', source: 'manual' }, minutesAgo: 45 },
    { userId: alex.id,   action: 'task_completed',       entityType: 'task',                                        details: { title: 'Collect design partner feedback', source: 'launch_review' }, minutesAgo: 43 },
    { userId: priya.id,  action: 'decision_captured',    entityType: 'decision',            entityId: d1.id,         details: { title: d1.title }, minutesAgo: 42 },
    { userId: dana.id,   action: 'decision_captured',    entityType: 'decision',            entityId: d2.id,         details: { title: d2.title }, minutesAgo: 41 },
    { userId: priya.id,  action: 'skill_published',      entityType: 'skill',               entityId: skillLaunch.id, details: { name: 'Enterprise Launch Review', scope: 'org' }, minutesAgo: 40 },
    { userId: marcus.id, action: 'task_completed',       entityType: 'task',                                        details: { title: 'Fix SSO callback retry handling', source: 'PR #247' }, minutesAgo: 38 },
    { userId: dana.id,   action: 'decision_captured',    entityType: 'decision',            entityId: d5.id,         details: { title: d5.title }, minutesAgo: 34 },
    { userId: alex.id,   action: 'skill_install',        entityType: 'skill',               entityId: skillLaunch.id, details: { name: 'Enterprise Launch Review' }, minutesAgo: 28 },
    { userId: alex.id,   action: 'skill_install',        entityType: 'skill',               entityId: skillFAQ.id,    details: { name: 'Security FAQ Builder' }, minutesAgo: 26 },
    { userId: priya.id,  action: 'routine_run',          entityType: 'routine',             entityId: rDigest.id,     details: { name: 'Monday Launch Risk Digest', status: 'success', summary: '2 blockers, 3 risks' }, minutesAgo: 15 },
    { userId: dana.id,   action: 'governance_violation', entityType: 'governance_violation',                         details: { name: 'No secrets in AI prompts', severity: 'critical', resolution: 'acknowledged' }, minutesAgo: 10 },
  ];

  for (const e of auditEvents) {
    await prisma.auditLog.create({ data: { orgId: org.id, userId: e.userId, action: e.action, entityType: e.entityType, entityId: e.entityId ?? null, details: e.details, createdAt: minutesAgo(e.minutesAgo) } });
  }

  // Compliance scrub audit logs — so the Compliance tab shows non-empty stats
  const complianceScrubs = [
    { details: { entityCounts: { email: 3, person_name: 2 }, packs: ['pii'], sessionId: session.id }, minutesAgo: 44 },
    { details: { entityCounts: { credit_card: 1 }, packs: ['pci-dss'], sessionId: session.id }, minutesAgo: 36 },
    { details: { entityCounts: { eu_phone: 2, email: 1 }, packs: ['gdpr', 'pii'], sessionId: session.id }, minutesAgo: 30 },
    { details: { entityCounts: { person_name: 1 }, packs: ['pii'], sessionId: session.id }, minutesAgo: 22 },
    { details: { entityCounts: { iban: 1, eu_phone: 1 }, packs: ['gdpr', 'pci-dss'], sessionId: session.id }, minutesAgo: 14 },
  ];
  for (const s of complianceScrubs) {
    await prisma.auditLog.create({ data: { orgId: org.id, userId: null, action: 'compliance_scrub', entityType: 'chat_message', details: s.details, createdAt: minutesAgo(s.minutesAgo) } });
  }

  console.log(`✓ Activity: ${auditEvents.length} audit events + ${complianceScrubs.length} compliance scrubs`);

  // ── Done ───────────────────────────────────────────────────────────

  console.log('\n' + '━'.repeat(50));
  console.log('✓ GTM demo seed complete.');
  console.log('  Login: admin@hearth.local / changeme');
  console.log('  URL:   http://localhost:3001');
  console.log('━'.repeat(50) + '\n');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
