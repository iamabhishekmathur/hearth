/**
 * Lightweight heuristic that decides whether an assistant message is shaped
 * like multi-step delegated work. Used to render an inline "This looks like
 * a task" nudge under the message.
 *
 * Intentionally conservative — false negatives are fine (the user can
 * always use the message-action button); false positives are bad (nag).
 *
 * The signal isn't perfect; it's a complement to `propose_task` (which
 * the agent invokes when *it* thinks delegation makes sense). The heuristic
 * here catches the cases where the agent didn't realise but the response
 * shape gives it away.
 */

const ACTION_VERBS = [
  // 1st-person commitment
  "i'll", "i will", "let me", "i can",
  // imperative steps
  "first", "then", "next", "finally", "after that",
  // delegation-tinted verbs in the response itself
  'draft', 'create', 'generate', 'write up', 'send', 'publish',
  'pull', 'fetch', 'compile', 'synthesize', 'assemble', 'review',
  'set up', 'configure', 'open a pr', 'file a ticket', 'post to',
];

// Lines that look like numbered or bulleted steps with verbs.
// Examples that should match:
//   "1. Pull the data..."
//   "2) Draft the email..."
//   "- First, fetch..."
//   "* Then synthesize..."
const STEP_LINE = /^\s*(?:\d+[.)]|[-*])\s+([A-Z][a-z]+(?:\s|,))/m;

// Phrases that announce a multi-step plan
const PLAN_ANNOUNCEMENT = [
  "here's the plan",
  "here's how i'd",
  "here's how i would",
  "here's how to",
  "let me walk through",
  "the steps are",
  "i'll need to",
  "we'll need to",
  "this is a multi-step",
];

export interface TaskShapeSignal {
  /** True if the message looks like delegated multi-step work. */
  matches: boolean;
  /** Short reason — useful for telemetry / debugging. */
  reason?: string;
}

export function detectTaskShape(content: string): TaskShapeSignal {
  if (!content || content.length < 80) return { matches: false };

  const lower = content.toLowerCase();

  // Signal 1: a numbered/bulleted list of action-shaped steps (≥3 items).
  const stepLineCount = (content.match(/^\s*(?:\d+[.)]|[-*])\s+\S/gm) || []).length;
  const hasStepList = stepLineCount >= 3 && STEP_LINE.test(content);

  // Signal 2: a "plan announcement" phrase.
  const announcedPlan = PLAN_ANNOUNCEMENT.some((p) => lower.includes(p));

  // Signal 3: density of action verbs.
  let verbHits = 0;
  for (const v of ACTION_VERBS) {
    if (lower.includes(v)) verbHits += 1;
    if (verbHits >= 4) break;
  }

  // Combine: any one strong signal triggers, OR step-list + verb density.
  if (hasStepList && verbHits >= 2) return { matches: true, reason: 'step-list+verbs' };
  if (announcedPlan && verbHits >= 2) return { matches: true, reason: 'announced-plan+verbs' };
  if (hasStepList && announcedPlan) return { matches: true, reason: 'step-list+announced-plan' };

  return { matches: false };
}

/**
 * Synthesises a one-line task title from a multi-step assistant response.
 * Picks the first step's verb-phrase if available; otherwise the first
 * sentence trimmed to ~80 chars.
 */
export function deriveTaskTitle(content: string): string {
  const stepMatch = content.match(/^\s*(?:\d+[.)]|[-*])\s+(.+?)$/m);
  if (stepMatch) {
    const step = stepMatch[1].trim();
    return step.length > 80 ? step.slice(0, 77) + '…' : step;
  }
  const firstSentence = content.split(/(?<=[.!?])\s+/)[0] ?? content;
  const trimmed = firstSentence.replace(/\s+/g, ' ').trim();
  return trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed;
}
