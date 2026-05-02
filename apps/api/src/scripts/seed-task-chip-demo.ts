/**
 * Seeds a demo chat session with a task chip already attached.
 *
 * Run: pnpm --filter @hearth/api exec tsx src/scripts/seed-task-chip-demo.ts [email]
 *
 * The seeded session contains four messages and one task promoted from
 * the second user message — so when you open the chat you immediately
 * see the persisted "✓ Task created" chip beneath that message.
 */
import { prisma } from '../lib/prisma.js';
import * as chatService from '../services/chat-service.js';

async function main() {
  const targetEmail = process.argv[2] ?? 'admin@hearth.local';

  const user = await prisma.user.findFirst({
    where: { email: targetEmail },
    select: { id: true, email: true, name: true, team: { select: { orgId: true } } },
  });
  if (!user) {
    throw new Error(`No user found with email ${targetEmail}. Pass an existing email as the first argument.`);
  }
  if (!user.team?.orgId) {
    throw new Error(`User ${user.email} has no team/org — cannot seed tenant data`);
  }
  const orgId: string = user.team.orgId;
  console.log(`Seeding for user ${user.name} <${user.email}> (${user.id}) in org ${orgId}`);

  // Idempotency: archive any prior demo session with the same title for this user.
  const priorTitle = 'Demo · Task chip preview';
  const prior = await prisma.chatSession.findMany({
    where: { userId: user.id, title: priorTitle, status: 'active' },
    select: { id: true },
  });
  for (const p of prior) {
    await prisma.chatSession.update({ where: { id: p.id }, data: { status: 'archived' } });
  }

  // Fresh session
  const session = await prisma.chatSession.create({
    data: {
      orgId,
      userId: user.id,
      title: priorTitle,
      status: 'active',
      visibility: 'private',
    },
  });

  // Helper: insert a message; createdAt is auto. We space messages out
  // by sleeping 5ms between inserts to guarantee ordering by createdAt.
  async function addMessage(role: 'user' | 'assistant', content: string, createdBy: string | null) {
    const msg = await prisma.chatMessage.create({
      data: { orgId, sessionId: session.id, role, content, createdBy },
    });
    await new Promise((r) => setTimeout(r, 5));
    return msg;
  }

  await addMessage(
    'user',
    "Hey — I want to brainstorm Q3 hiring. We're light on senior PMs and the staff role has been open six months.",
    user.id,
  );
  await addMessage(
    'assistant',
    "Got it. A few angles worth pulling apart:\n\n1. **Seniority mix** — what's your current PM-to-engineer ratio, and where do gaps hurt most (planning velocity, prioritization, customer signal)?\n2. **Staff role specifically** — six months open is long enough that the JD itself is probably the issue. Worth re-scoping?\n3. **Sourcing channel** — referrals vs inbound vs recruiter pipeline performance.\n\nWhich of these is the bigger pain right now?",
    null,
  );
  const promotionAnchor = await addMessage(
    'user',
    "Let me draft a fresh JD for the staff PM role and circulate it. Make this a task.",
    user.id,
  );
  await addMessage(
    'assistant',
    "Done — added it to your tasks board with the conversation attached as context. The JD draft will land in your backlog.",
    null,
  );

  // Promote the third message into a real task using the production code path.
  const result = await chatService.promoteMessageToTask({
    sessionId: session.id,
    messageId: promotionAnchor.id,
    userId: user.id,
    title: 'Draft fresh JD for staff PM role',
    description:
      "Re-scope the staff PM role; current JD has been live six months with no successful hire. Reference the brainstorm in the source chat for context.",
    attachRecentN: 4,
    targetStatus: 'backlog',
    priority: 2,
    provenance: 'chat_button',
  });

  console.log('\n✓ Demo session created:');
  console.log(`  session id:  ${session.id}`);
  console.log(`  open it at:  http://localhost:3000/#/chat (look for "Demo · Task chip preview" in your tabs/history)`);
  console.log('\n✓ Task promoted from message:');
  console.log(`  task id:     ${result.task.id}`);
  console.log(`  title:       ${result.task.title}`);
  console.log(`  status:      ${result.task.status}`);
  console.log(`  context msgs: ${result.messageCount}`);
  console.log(`  view it at:  http://localhost:3000/#/tasks?taskId=${result.task.id}`);
  console.log('\nNotes:');
  console.log('  - The chip will render under the third message ("Make this a task").');
  console.log('  - The chip is hydrated from producedTaskIds (no slide-in or undo — it\'s "historical" once you reload).');
  console.log('  - To see the slide-in toast + undo countdown, use the message-action button or /task on a fresh message.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
