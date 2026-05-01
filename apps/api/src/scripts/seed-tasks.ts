import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seeds sample tasks spanning every kanban column.
 *
 * For planning/executing/review/done tasks we also seed simulated subtasks,
 * execution steps (with phase + input/output), and reviews so the whole
 * pipeline is visually populated without needing a live agent loop.
 *
 * Idempotent: clears prior seed data first (matched by sample titles).
 */
async function main() {
  const user = await prisma.user.findFirst({
    include: { team: { select: { orgId: true } } },
  });
  if (!user) {
    console.log('No user found — run the app and register first');
    process.exit(1);
  }
  if (!user.team?.orgId) {
    console.log(`User ${user.email} has no team/org — cannot seed tenant data`);
    process.exit(1);
  }
  const orgId: string = user.team.orgId;

  console.log(`Seeding tasks for user: ${user.email} (${user.id}) in org ${orgId}`);

  const tasks: Array<{
    title: string;
    description: string;
    status: string;
    source: string;
    priority: number;
    /** Simulated pipeline artifacts — subtasks, steps, reviews */
    subtasks?: Array<{
      title: string;
      description?: string;
      status?: string;
      agentOutput?: Prisma.InputJsonValue;
      executionSteps?: Array<{
        description: string;
        status: string;
        toolUsed?: string;
        input?: Prisma.InputJsonValue;
        output?: Prisma.InputJsonValue;
        durationMs?: number;
      }>;
    }>;
    planningSteps?: Array<{
      description: string;
      status: string;
      output?: Prisma.InputJsonValue;
      durationMs?: number;
    }>;
    executionSteps?: Array<{
      description: string;
      status: string;
      toolUsed?: string;
      input?: Prisma.InputJsonValue;
      output?: Prisma.InputJsonValue;
      durationMs?: number;
    }>;
    agentOutput?: Prisma.InputJsonValue;
    reviews?: Array<{ decision: string; feedback?: string }>;
  }> = [
    // ── Auto-detected ───────────────────────────────────────────────
    {
      title: 'Review Q2 product roadmap',
      description:
        'Go through the product roadmap doc and identify gaps in the AI features section.',
      status: 'auto_detected',
      source: 'email',
      priority: 2,
    },
    {
      title: "Summarize last week's standup notes",
      description: 'Pull standup notes from Slack and create a weekly digest.',
      status: 'auto_detected',
      source: 'slack',
      priority: 1,
    },

    // ── Backlog ─────────────────────────────────────────────────────
    {
      title: 'Draft investor update email',
      description:
        'Monthly investor update covering ARR growth, new features shipped, and hiring.',
      status: 'backlog',
      source: 'manual',
      priority: 3,
    },
    {
      title: 'Prepare onboarding guide for new hires',
      description:
        'Create a step-by-step onboarding doc covering tools, access, and first-week tasks.',
      status: 'backlog',
      source: 'meeting',
      priority: 1,
    },
    {
      title: 'Audit Stripe webhook handlers',
      description:
        'Verify all webhook event types are handled and error cases are covered.',
      status: 'backlog',
      source: 'manual',
      priority: 2,
    },

    // ── Planning ────────────────────────────────────────────────────
    {
      title: 'Research competitor pricing pages',
      description:
        'Analyze pricing strategies of top 5 competitors and summarize findings.',
      status: 'planning',
      source: 'agent_proposed',
      priority: 2,
      planningSteps: [
        {
          description:
            'Planning: decompose "Research competitor pricing pages" into subtasks',
          status: 'running',
        },
      ],
      subtasks: [
        {
          title: 'Identify top 5 competitors',
          description: 'Linear, Asana, Notion, ClickUp, Monday',
          status: 'backlog',
        },
        {
          title: 'Scrape each pricing page',
          description: 'Use @Web tool to pull plan/tier/price data',
          status: 'backlog',
        },
      ],
    },
    {
      title: 'Design memory search UX flow',
      description:
        'Create wireframes for the hybrid search experience in the memory inspector.',
      status: 'planning',
      source: 'manual',
      priority: 1,
      planningSteps: [
        {
          description: 'Planning: decompose "Design memory search UX flow" into subtasks',
          status: 'completed',
          output: {
            subtasks: [
              { title: 'Inventory existing search entry points' },
              { title: 'Sketch hybrid search result layout' },
              { title: 'Validate with 2 design partners' },
            ],
          },
          durationMs: 4200,
        },
        {
          description: 'Planning: expand "Validate with 2 design partners"',
          status: 'running',
        },
      ],
      subtasks: [
        { title: 'Inventory existing search entry points', status: 'backlog' },
        { title: 'Sketch hybrid search result layout', status: 'backlog' },
        { title: 'Validate with 2 design partners', status: 'backlog' },
      ],
    },

    // ── Executing ───────────────────────────────────────────────────
    {
      title: 'Migrate analytics to PostHog',
      description:
        'Replace current analytics with PostHog events. Update dashboard queries.',
      status: 'executing',
      source: 'manual',
      priority: 3,
      executionSteps: [
        {
          description: 'Executing: Migrate analytics to PostHog',
          status: 'running',
        },
        {
          description: 'Tool: search_codebase',
          toolUsed: 'search_codebase',
          status: 'completed',
          input: { query: 'analytics.track(' },
          output: { matches: 47, files: 12 },
          durationMs: 680,
        },
        {
          description: 'Tool: write_file',
          toolUsed: 'write_file',
          status: 'running',
          input: { path: 'apps/web/src/lib/analytics.ts' },
        },
      ],
      subtasks: [
        {
          title: 'Inventory existing analytics calls',
          status: 'done',
          agentOutput: {
            result:
              'Found 47 analytics.track() calls across 12 files. Key events: page_view (14), button_click (9), form_submit (8), api_call (6), error (5), custom (5). Most calls are in apps/web/src/components/ and apps/web/src/pages/.',
          },
          executionSteps: [
            {
              description: 'Tool: search_codebase',
              toolUsed: 'search_codebase',
              status: 'completed',
              input: { query: 'analytics.track(' },
              output: { matches: 47, files: 12 },
              durationMs: 680,
            },
            {
              description: 'Tool: read_file',
              toolUsed: 'read_file',
              status: 'completed',
              input: { path: 'apps/web/src/lib/analytics.ts' },
              output: { lines: 84 },
              durationMs: 120,
            },
          ],
        },
        {
          title: 'Map events to PostHog schema',
          status: 'executing',
          executionSteps: [
            {
              description: 'Tool: read_file',
              toolUsed: 'read_file',
              status: 'completed',
              input: { path: 'docs/analytics-events.md' },
              output: { lines: 142 },
              durationMs: 90,
            },
            {
              description: 'Tool: write_file',
              toolUsed: 'write_file',
              status: 'running',
              input: { path: 'apps/web/src/lib/posthog-events.ts' },
            },
          ],
        },
        { title: 'Replace analytics lib with posthog-js', status: 'backlog' },
      ],
    },
    {
      title: 'Generate weekly team summary report',
      description:
        'Agent is compiling activity from Slack, GitHub, and Jira into a summary.',
      status: 'executing',
      source: 'agent_proposed',
      priority: 2,
      executionSteps: [
        {
          description: 'Executing: Generate weekly team summary report',
          status: 'running',
        },
        {
          description: 'Tool: slack.search_messages',
          toolUsed: 'slack.search_messages',
          status: 'completed',
          input: { channel: '#engineering', after: '2026-04-09' },
          output: { messages: 128, threads: 34 },
          durationMs: 1420,
        },
        {
          description: 'Tool: github.list_merged_prs',
          toolUsed: 'github.list_merged_prs',
          status: 'completed',
          input: { org: 'hearth', since: '2026-04-09' },
          output: { prs: 22, authors: 6 },
          durationMs: 890,
        },
        {
          description: 'Tool: jira.search_issues',
          toolUsed: 'jira.search_issues',
          status: 'running',
          input: { jql: 'project = PROD AND updated >= -7d' },
        },
      ],
    },

    // ── Review ──────────────────────────────────────────────────────
    {
      title: 'Fix SSO callback for Okta',
      description:
        'SAML assertion parsing fails for Okta-specific attribute mapping.',
      status: 'review',
      source: 'manual',
      priority: 3,
      executionSteps: [
        {
          description: 'Executing: Fix SSO callback for Okta',
          status: 'completed',
          output: {
            result:
              'Updated SAML assertion parser at apps/api/src/auth/saml.ts to handle Okta attribute aliases (email, firstName, lastName). Added unit tests covering 3 Okta response shapes.',
          },
          durationMs: 18420,
        },
      ],
      agentOutput: {
        result:
          'Updated SAML assertion parser at apps/api/src/auth/saml.ts to handle Okta attribute aliases (email, firstName, lastName). Added unit tests covering 3 Okta response shapes. All existing Google-SAML tests still pass. Diff touches 2 files, 84 lines.',
      },
    },
    {
      title: 'Update API rate limiting docs',
      description:
        'Document the new rate limits for public endpoints in the API reference.',
      status: 'review',
      source: 'manual',
      priority: 1,
      executionSteps: [
        {
          description: 'Executing: Update API rate limiting docs',
          status: 'completed',
          output: {
            result:
              'Added rate limit table to /docs/api-reference.md covering /auth (5/min), /chat (60/min), /memory (100/min). Also noted the 429 response headers: X-RateLimit-Remaining, X-RateLimit-Reset.',
          },
          durationMs: 6200,
        },
      ],
      agentOutput: {
        result:
          'Added rate limit table to /docs/api-reference.md covering /auth (5/min), /chat (60/min), /memory (100/min). Also noted the 429 response headers: X-RateLimit-Remaining, X-RateLimit-Reset.',
      },
    },

    // ── Done ────────────────────────────────────────────────────────
    {
      title: 'Deploy v2.1 hotfix to staging',
      description:
        'Memory search timeout fix deployed and verified on staging.',
      status: 'done',
      source: 'manual',
      priority: 3,
      executionSteps: [
        {
          description: 'Executing: Deploy v2.1 hotfix to staging',
          status: 'completed',
          output: { result: 'Hotfix v2.1.3 deployed. p95 latency dropped from 2.8s → 340ms.' },
          durationMs: 12400,
        },
      ],
      agentOutput: {
        result: 'Hotfix v2.1.3 deployed. p95 latency dropped from 2.8s → 340ms.',
      },
      reviews: [{ decision: 'approved' }],
    },
    {
      title: 'Set up Sentry error tracking',
      description:
        'Configured Sentry for API and web, verified error capture works.',
      status: 'done',
      source: 'manual',
      priority: 2,
      executionSteps: [
        {
          description: 'Executing: Set up Sentry error tracking',
          status: 'completed',
          output: {
            result:
              'Sentry SDKs installed and configured in both apps. Test error captured successfully on web and api. Release tracking enabled.',
          },
          durationMs: 9800,
        },
      ],
      agentOutput: {
        result:
          'Sentry SDKs installed and configured in both apps. Test error captured successfully on web and api. Release tracking enabled.',
      },
      reviews: [
        {
          decision: 'changes_requested',
          feedback: 'Include source maps upload so stacktraces are symbolicated.',
        },
        { decision: 'approved' },
      ],
    },
  ];

  // Idempotent: nuke prior seed rows for this user
  const titles = tasks.map((t) => t.title);
  const existing = await prisma.task.findMany({
    where: { userId: user.id, title: { in: titles } },
    select: { id: true },
  });
  if (existing.length > 0) {
    const existingIds = existing.map((t) => t.id);
    await prisma.taskReview.deleteMany({ where: { taskId: { in: existingIds } } });
    await prisma.taskExecutionStep.deleteMany({
      where: { taskId: { in: existingIds } },
    });
    await prisma.taskComment.deleteMany({ where: { taskId: { in: existingIds } } });
    // Subtasks reference parent tasks — remove subtasks before parents
    await prisma.task.deleteMany({ where: { parentTaskId: { in: existingIds } } });
    await prisma.task.deleteMany({ where: { id: { in: existingIds } } });
    console.log(`Cleared ${existing.length} prior seed tasks`);
  }

  for (const t of tasks) {
    const task = await prisma.task.create({
      data: {
        orgId,
        userId: user.id,
        title: t.title,
        description: t.description,
        status: t.status as never,
        source: t.source as never,
        priority: t.priority,
        context: {},
        agentOutput: t.agentOutput ?? undefined,
      },
    });

    // Planning steps
    let stepNumber = 0;
    for (const s of t.planningSteps ?? []) {
      stepNumber += 1;
      await prisma.taskExecutionStep.create({
        data: {
          orgId,
          taskId: task.id,
          stepNumber,
          description: s.description,
          status: s.status as never,
          phase: 'planning',
          output: s.output,
          durationMs: s.durationMs ?? null,
        },
      });
    }

    // Execution steps
    for (const s of t.executionSteps ?? []) {
      stepNumber += 1;
      await prisma.taskExecutionStep.create({
        data: {
          orgId,
          taskId: task.id,
          stepNumber,
          description: s.description,
          status: s.status as never,
          phase: 'execution',
          toolUsed: s.toolUsed ?? null,
          input: s.input ?? undefined,
          output: s.output ?? undefined,
          durationMs: s.durationMs ?? null,
        },
      });
    }

    // Subtasks
    for (const sub of t.subtasks ?? []) {
      const subtask = await prisma.task.create({
        data: {
          orgId,
          userId: user.id,
          title: sub.title,
          description: sub.description ?? null,
          source: 'sub_agent',
          status: (sub.status ?? 'backlog') as never,
          parentTaskId: task.id,
          context: {},
          agentOutput: sub.agentOutput ?? undefined,
        },
      });

      // Subtask execution steps
      let subStepNumber = 0;
      for (const s of sub.executionSteps ?? []) {
        subStepNumber += 1;
        await prisma.taskExecutionStep.create({
          data: {
            orgId,
            taskId: subtask.id,
            stepNumber: subStepNumber,
            description: s.description,
            status: s.status as never,
            phase: 'execution',
            toolUsed: s.toolUsed ?? null,
            input: s.input ?? undefined,
            output: s.output ?? undefined,
            durationMs: s.durationMs ?? null,
          },
        });
      }
    }

    // Reviews
    for (const r of t.reviews ?? []) {
      await prisma.taskReview.create({
        data: {
          orgId,
          taskId: task.id,
          reviewerId: user.id,
          decision: r.decision as never,
          feedback: r.feedback ?? null,
        },
      });
    }
  }

  console.log(`Created ${tasks.length} sample tasks with pipeline artifacts`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
