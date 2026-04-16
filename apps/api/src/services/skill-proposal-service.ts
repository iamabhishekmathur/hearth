import { prisma } from '../lib/prisma.js';

/**
 * Check if a task qualifies for a skill proposal (>3 execution steps).
 */
export async function shouldPropose(taskId: string): Promise<boolean> {
  const count = await prisma.taskExecutionStep.count({ where: { taskId } });
  return count > 3;
}

/**
 * Check if a proposal already exists for this task.
 */
export async function hasProposal(taskId: string): Promise<boolean> {
  const existing = await prisma.skill.findFirst({
    where: { sourceTaskId: taskId },
  });
  return !!existing;
}

/**
 * Generate a skill proposal from task execution steps using an LLM.
 */
export async function generateProposal(taskId: string): Promise<{
  name: string;
  description: string;
  content: string;
} | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { executionSteps: { orderBy: { stepNumber: 'asc' } } },
  });

  if (!task || !task.executionSteps.length) return null;

  // Build the skill proposal using a simple template
  // In production, this would call the LLM via providerRegistry
  const name = `${task.title.slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '')} Skill`.trim();
  const description = `Auto-generated skill from task: ${task.title}`;
  const content = [
    '---',
    `name: "${name}"`,
    `description: "${description}"`,
    '---',
    '',
    `# ${name}`,
    '',
    `This skill was auto-generated from the task "${task.title}".`,
    '',
    '## Steps',
    '',
    ...task.executionSteps.map(
      (s) => `${s.stepNumber}. **${s.description}**${s.toolUsed ? ` (tool: ${s.toolUsed})` : ''}`,
    ),
    '',
    '## Context',
    '',
    task.description ?? 'No description provided.',
  ].join('\n');

  return { name, description, content };
}

/**
 * Create a skill proposal (draft skill linked to the source task).
 */
export async function createProposal(
  taskId: string,
  userId: string,
  orgId: string,
  proposal: { name: string; description: string; content: string },
) {
  return prisma.skill.create({
    data: {
      orgId,
      authorId: userId,
      name: proposal.name,
      description: proposal.description,
      content: proposal.content,
      scope: 'personal',
      status: 'draft',
      sourceTaskId: taskId,
      requiredIntegrations: [],
      requiredCapabilities: [],
    },
    include: {
      author: { select: { id: true, name: true } },
    },
  });
}

/**
 * Get proposals for a given task.
 */
export async function getProposalsByTask(taskId: string) {
  return prisma.skill.findMany({
    where: { sourceTaskId: taskId },
    include: { author: { select: { id: true, name: true } } },
  });
}

/**
 * Submit a draft skill for review.
 */
export async function submitForReview(skillId: string, userId: string) {
  const skill = await prisma.skill.findFirst({
    where: { id: skillId, authorId: userId, status: 'draft' },
  });
  if (!skill) return null;

  return prisma.skill.update({
    where: { id: skillId },
    data: { status: 'pending_review' },
    include: { author: { select: { id: true, name: true } } },
  });
}

/**
 * Dismiss a proposal by deleting it.
 */
export async function dismissProposal(skillId: string, userId: string) {
  const skill = await prisma.skill.findFirst({
    where: { id: skillId, authorId: userId, status: 'draft', sourceTaskId: { not: null } },
  });
  if (!skill) return null;

  return prisma.skill.delete({ where: { id: skillId } });
}
