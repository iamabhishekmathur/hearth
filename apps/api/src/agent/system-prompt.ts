import type { AgentContext } from './types.js';
import { prisma } from '../lib/prisma.js';
import { getIdentityChain } from '../services/identity-service.js';
import { searchMemory, type MemoryScope } from '../services/memory-service.js';
import { generateEmbedding } from '../services/embedding-service.js';
import { getGovernanceSettings, listPolicies } from '../services/governance-service.js';
import { searchExperiences } from '../services/experience-service.js';
import {
  isCognitiveEnabledForOrg,
  loadCognitiveProfile,
  searchThoughtPatterns,
  logCognitiveQuery,
} from '../services/cognitive-profile-service.js';
import { logger } from '../lib/logger.js';

// ─── Prompt Budget (approximate token counts per section) ────────────
const SECTION_BUDGETS: Record<string, number> = {
  identity: 2000,
  userMemories: 1000,
  experiences: 500,
  relevantContext: 1000,
  skills: 3000,
  governance: 500,
  routineState: 1500,
  artifacts: 300,
  cognitive: 1000,
  decisions: 800,
};

/**
 * Truncates text to fit within a token budget (rough: 1 token ≈ 4 chars).
 * Preserves complete items (lines) rather than cutting mid-line.
 */
function truncateToTokenBudget(text: string, budgetTokens: number): string {
  const budgetChars = budgetTokens * 4;
  if (text.length <= budgetChars) return text;

  const lines = text.split('\n');
  let result = '';
  let truncatedCount = 0;

  for (const line of lines) {
    if ((result + line + '\n').length > budgetChars) {
      truncatedCount = lines.length - result.split('\n').length + 1;
      break;
    }
    result += line + '\n';
  }

  if (truncatedCount > 0) {
    result += `\n[... ${truncatedCount} more items truncated]`;
  }

  return result.trim();
}

const DEFAULT_SYSTEM_PROMPT = `You are Hearth, an AI productivity assistant for teams. You operate as a task-doer, not just an advisor — your default mode is to execute, not to explain.

## Operating principles

**Bias toward action.** When a user asks you to do something, do it. Don't ask clarifying questions unless ambiguity would cause you to take a materially wrong action. If you need to make a reasonable assumption, state it briefly and proceed.

**Be concise.** Skip preamble. Don't narrate what you're about to do — just do it. Reserve explanation for when it genuinely helps the user understand or decide.

**Confirm before irreversible actions.** For actions that can't be undone — sending emails, deleting data, posting publicly — confirm intent with one sentence before proceeding. For everything else, act.

**Surface results, not process.** When a task is complete, lead with the outcome. Optionally note what you did in one line. Don't walk through your reasoning unless asked.

## What you can do

### Information & Research
- Search the web for current information, documentation, and facts
- Fetch and extract content from URLs (articles, docs, APIs)
- Search past conversations for context and decisions
- Analyze images and screenshots

### Create & Edit
- Create persistent artifacts: code files, documents, diagrams, tables, interactive HTML
- Update existing artifacts or list artifacts in the current session
- Execute Python and Node.js code in a secure sandbox
- Read and write files in the sandbox environment

### Productivity & Task Management
- Create, update, and list tasks on the user's Kanban board
- Create and manage scheduled routines (recurring automations)
- Schedule one-time actions for the future
- Delegate complex subtasks to focused sub-agents

### Memory & Context
- Remember preferences, facts, and context across conversations
- Search memory for previously stored information
- Ask clarifying questions when requests are ambiguous

### Decision Context
- Search organizational decision history for relevant precedents
- Proactively surface past decisions relevant to current discussion
- Help users capture decisions from conversations
- Identify when discussions contradict established patterns

### Integrations
- Interact with connected services (Slack, Gmail, Jira, GitHub, Notion, Google Calendar, Google Drive) via MCP connectors

## What you won't do

- Take actions on behalf of someone other than the user who instructed you
- Share information from one user's context with another without explicit permission
- Execute destructive or irreversible actions without a confirmation step
- Fabricate URLs, citations, or data — use web_search or web_fetch to verify when unsure
- Access systems or data outside the user's connected integrations

## Format guidance

- Use markdown for documents, structured outputs, and anything the user will read carefully
- Use plain prose for quick answers and conversational replies
- Use bullet points for lists of items, options, or steps — not for everything
- Keep task confirmations to one line: what you did and any key result
- When producing code, documents, or rich content, prefer creating an artifact so the user can view, copy, and iterate on it

When in doubt: act, be brief, and let the user redirect you.`;

/**
 * Builds the system prompt by assembling the full identity chain:
 * org SOUL.md → user SOUL.md → IDENTITY.md → relevant memories → installed skills
 */
export async function buildSystemPrompt(context: Partial<AgentContext>): Promise<string> {
  const parts: string[] = [];

  // 1. Identity chain (org SOUL.md → user SOUL.md → IDENTITY.md)
  if (context.orgId && context.userId) {
    try {
      const chain = await getIdentityChain(context.orgId, context.userId);

      if (chain.orgSoul) {
        parts.push(chain.orgSoul);
      }

      if (chain.userSoul) {
        parts.push(chain.userSoul);
      }

      if (chain.userIdentity) {
        parts.push(chain.userIdentity);
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to load identity chain');
    }
  }

  // Use default prompt if no identity documents are configured
  if (parts.length === 0) {
    parts.push(DEFAULT_SYSTEM_PROMPT);
  }

  // 2a. User preferences — always loaded regardless of query relevance
  if (context.orgId && context.userId) {
    try {
      const userMemories = await prisma.memoryEntry.findMany({
        where: {
          orgId: context.orgId,
          userId: context.userId,
          layer: 'user',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      });

      if (userMemories.length > 0) {
        let memSection = '\n## User Context\nAlways apply these preferences and facts about the user:\n';
        for (const mem of userMemories) {
          memSection += `\n- ${mem.content}`;
        }
        parts.push(truncateToTokenBudget(memSection, SECTION_BUDGETS.userMemories));
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to load user memories');
    }
  }

  // 2b. Past experiences — semantic search for relevant learnings
  if (context.orgId && context.userId && context.latestMessage) {
    try {
      const experiences = await searchExperiences(
        context.userId, context.orgId,
        context.latestMessage,
        { limit: 3 },
      );
      if (experiences.length > 0) {
        let expSection = '\n## Past Experience\nRelevant learnings from previous sessions:\n';
        for (const exp of experiences) {
          expSection += `\n**${exp.taskSummary}** (${exp.outcome})`;
          for (const learning of exp.learnings) {
            expSection += `\n- ${learning}`;
          }
        }
        parts.push(truncateToTokenBudget(expSection, SECTION_BUDGETS.experiences));
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to search experiences for prompt');
    }
  }

  // 2c. Relevant memories — semantic search using the latest message
  if (context.orgId && context.userId && context.latestMessage) {
    try {
      const scope: MemoryScope = {
        orgId: context.orgId,
        teamId: context.teamId ?? null,
        userId: context.userId,
        role: 'member',
      };

      const embedding = await generateEmbedding(context.latestMessage);
      const memories = await searchMemory(scope, context.latestMessage, {
        limit: 10,
        embedding: embedding ?? undefined,
      });

      // Filter out user-layer entries already included above
      const extraMemories = memories.filter(
        (mem) => mem && typeof mem === 'object' && 'layer' in mem && (mem as { layer: string }).layer !== 'user',
      );

      if (extraMemories.length > 0) {
        let ctxSection = '\n## Relevant Context\nThe following was retrieved from team/org memory:\n';
        for (const mem of extraMemories) {
          if (mem && typeof mem === 'object' && 'content' in mem) {
            const entry = mem as { layer: string; content: string };
            ctxSection += `\n- [${entry.layer}] ${entry.content}`;
          }
        }
        parts.push(truncateToTokenBudget(ctxSection, SECTION_BUDGETS.relevantContext));
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to search memory for prompt');
    }
  }

  // 2d. Decision context — inject relevant past decisions and principles
  if (context.orgId && context.latestMessage) {
    try {
      const { findPrecedents, listPrinciples } = await import('../services/decision-service.js');
      const scope = {
        orgId: context.orgId,
        userId: context.userId ?? '',
        teamId: context.teamId ?? null,
        role: 'member',
      };

      const [relevantDecisions, principles] = await Promise.all([
        findPrecedents(scope, context.latestMessage, { limit: 5 }).catch(() => []),
        listPrinciples(context.orgId).catch(() => []),
      ]);

      const activePrinciples = principles.filter((p: any) => p.status === 'active');

      if (relevantDecisions.length > 0 || activePrinciples.length > 0) {
        let decSection = '\n## Organizational Decision Context\n';

        if (relevantDecisions.length > 0) {
          decSection += '\n### Past Decisions\n';
          for (const d of relevantDecisions) {
            const outcomeNote = '';
            decSection += `- [${d.domain ?? 'general'}] "${d.title}" (${d.status}, ${d.confidence} confidence)\n`;
            decSection += `  Rationale: ${d.reasoning.slice(0, 200)}${d.reasoning.length > 200 ? '...' : ''}\n`;
          }
        }

        if (activePrinciples.length > 0) {
          decSection += '\n### Applicable Principles\n';
          for (const p of activePrinciples.slice(0, 3)) {
            decSection += `- "${p.title}" (${p.status})\n`;
            decSection += `  Guideline: ${p.guideline}\n`;
          }
        }

        decSection += '\nWhen a user is making a decision, use suggest_precedent to surface relevant history.\nWhen a decision is made, use capture_decision to record it.\n';

        parts.push(truncateToTokenBudget(decSection, SECTION_BUDGETS.decisions));
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to load decision context for prompt');
    }
  }

  // 3. Installed skills (full content, not just names)
  if (context.userId) {
    try {
      const userSkills = await prisma.userSkill.findMany({
        where: { userId: context.userId },
        include: { skill: { select: { name: true, description: true, content: true } } },
      });

      if (userSkills.length > 0) {
        let skillSection = '\n## Installed Skills\nApply these skills when relevant:\n';
        for (const us of userSkills) {
          if (us.skill) {
            skillSection += `\n### ${us.skill.name}`;
            if (us.skill.description) {
              skillSection += `\n${us.skill.description}`;
            }
            skillSection += `\n${us.skill.content}\n`;
          }
        }
        parts.push(truncateToTokenBudget(skillSection, SECTION_BUDGETS.skills));
      }
    } catch {
      // Skills table may not exist yet during initial setup
    }
  }

  // 3b. Governance guidelines — inject when governance is enabled
  if (context.orgId) {
    try {
      const govSettings = await getGovernanceSettings(context.orgId);
      if (govSettings?.enabled) {
        const policies = await listPolicies(context.orgId);
        const activePolicies = policies.filter(p => p.enabled);
        if (activePolicies.length > 0) {
          let govSection = '\n## Governance Guidelines\nThe following organizational policies are in effect. Do not help the user violate these guidelines. If a request conflicts with a policy, explain which guideline applies and suggest an alternative approach.\n';
          for (const policy of activePolicies) {
            const severity = policy.severity === 'critical' ? ' [CRITICAL]' : '';
            govSection += `\n- **${policy.name}**${severity}: ${policy.description || 'No description provided'}`;
          }
          parts.push(truncateToTokenBudget(govSection, SECTION_BUDGETS.governance));
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to load governance policies for prompt');
    }
  }

  // 3c. Cognitive profile context — inject when @mention cognitive query
  if (context.cognitiveQuerySubjectId && context.orgId) {
    try {
      const orgEnabled = await isCognitiveEnabledForOrg(context.orgId);
      if (orgEnabled) {
        // Load subject user's profile
        const subjectUser = await prisma.user.findUnique({
          where: { id: context.cognitiveQuerySubjectId },
          select: { name: true },
        });

        // Check user-level opt-in
        const profile = await loadCognitiveProfile(
          context.cognitiveQuerySubjectId,
          context.orgId,
        );

        if (profile === null) {
          // User has opted out or no profile yet
          const subjectName = subjectUser?.name ?? 'This user';
          parts.push(`\n## Cognitive Profile Query\n${subjectName} has opted out of cognitive profiles or has no profile data yet. Respond to the query based on your general knowledge instead, and let the user know that cognitive profile data is not available for this person.`);
        } else {
          const subjectName = subjectUser?.name ?? 'the subject user';

          // Search for relevant thought patterns
          const patterns = context.latestMessage
            ? await searchThoughtPatterns(
                context.cognitiveQuerySubjectId,
                context.orgId,
                context.latestMessage,
                { limit: 10 },
              )
            : [];

          let cogSection = `\n## Reasoning as ${subjectName}'s Perspective

You've been asked to reason from ${subjectName}'s perspective. Use the cognitive profile and thought patterns below to ground your response. Cite specific evidence.
Be honest about uncertainty — if you lack data, say so.

You are NOT ${subjectName}. You're simulating their perspective based on observed patterns.
Distinguish between things they've explicitly stated vs. things you're inferring.

### Profile
\`\`\`json
${JSON.stringify(profile, null, 2)}
\`\`\``;

          if (patterns.length > 0) {
            cogSection += '\n\n### Relevant Thought Patterns\n';
            for (const p of patterns) {
              cogSection += `\n**[${p.category}]** ${p.pattern}`;
              cogSection += `\n  _Evidence:_ "${p.sourceExcerpt}"`;
              cogSection += `\n  _Observed ${p.observationCount}x, confidence: ${p.confidence.toFixed(2)}_\n`;
            }
          }

          parts.push(truncateToTokenBudget(cogSection, SECTION_BUDGETS.cognitive));

          // Audit trail
          if (context.userId && context.sessionId) {
            logCognitiveQuery(
              context.orgId,
              context.userId,
              context.cognitiveQuerySubjectId,
              context.sessionId,
            ).catch(err => logger.debug({ err }, 'Failed to log cognitive query'));
          }
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to load cognitive context for prompt');
    }
  }

  // 4. Routine State (Feature 1) — inject previous run context
  if (context.routineRunContext) {
    const { state, previousRuns, stateConfig } = context.routineRunContext;

    if (Object.keys(state).length > 0) {
      parts.push('\n## Routine State');
      parts.push('Persistent key-value state from previous runs. Use the `routine_state` tool to get/set/delete keys.\n');
      parts.push('```json');
      parts.push(JSON.stringify(state, null, 2));
      parts.push('```');
    }

    if (previousRuns.length > 0) {
      parts.push('\n## Previous Run Outputs');
      if (stateConfig.trackDeltas) {
        parts.push('Delta tracking is enabled. Focus on what changed since the last run.\n');
      }
      for (const run of previousRuns) {
        parts.push(`### Run ${run.startedAt} (${run.status})`);
        if (run.summary) {
          parts.push(`Summary: ${run.summary}`);
        }
        if (run.output) {
          parts.push(String(run.output));
        }
        parts.push('');
      }
    }
  }

  // 4b. Trigger Event (Feature 2) — inject event that fired this routine
  if (context.triggerEvent) {
    const event = context.triggerEvent;
    parts.push('\n## Trigger Event');
    parts.push(`This routine was triggered by an external event.\n`);
    parts.push(`- **Provider:** ${event.provider}`);
    parts.push(`- **Event Type:** ${event.eventType}`);
    if (event.actor) parts.push(`- **Actor:** ${event.actor}`);
    if (event.resource) {
      parts.push(`- **Resource:** ${event.resource.type} #${event.resource.id}${event.resource.title ? ` — ${event.resource.title}` : ''}`);
      if (event.resource.url) parts.push(`- **URL:** ${event.resource.url}`);
    }
    // Truncate payload to 4KB
    const payloadStr = JSON.stringify(event.payload, null, 2);
    const truncatedPayload = payloadStr.length > 4096
      ? payloadStr.slice(0, 4096) + '\n... [truncated]'
      : payloadStr;
    parts.push('\nEvent Payload:');
    parts.push('```json');
    parts.push(truncatedPayload);
    parts.push('```');
  }

  // 5. Skill proposal guidance
  parts.push(`## Skill Proposals

If you solve a multi-step problem using 3+ tools and the approach would be useful for similar future tasks, use the \`propose_skill\` tool to save it as a reusable skill. The skill will be saved as a draft for the user to review — it won't be auto-applied. Only propose skills for genuinely reusable patterns, not one-off tasks.`);

  // 6. Artifacts guidance
  parts.push(`## Artifacts

Use artifacts when producing content the user will want to view, copy, or iterate on. Supported types: code, document, diagram, table, html.

- **create_artifact** — Create a new artifact with a title, type, and content.
- **update_artifact** — Update an existing artifact by ID. Use this when the user asks for changes to something you already created.
- **list_artifacts** — List all artifacts in the current session. Use this to check what you've already created before creating duplicates.

Guidelines:
- Prefer artifacts over inline code blocks for anything longer than ~20 lines.
- Give each artifact a short, descriptive title.
- When the user says "update that" or "change the code", use update_artifact on the most recent relevant artifact.
- Use list_artifacts if you're unsure whether an artifact already exists for a given topic.`);

  return parts.join('\n\n');
}
