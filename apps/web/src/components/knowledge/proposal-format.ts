import type { KnowledgeProposalAffected } from '@hearth/shared';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Short "Why" lines from signal counts, in a fixed order, e.g.
 * "3 agents flagged a gap." "2 people corrected an answer."
 */
export function whySentences(counts: Record<string, number>): string[] {
  const out: string[] = [];
  const n = (k: string) => counts[k] ?? 0;
  if (n('empty_search'))
    out.push(`${n('empty_search')} ${plural(n('empty_search'), 'agent', 'agents')} flagged a gap.`);
  if (n('correction'))
    out.push(
      `${n('correction')} ${plural(n('correction'), 'person', 'people')} corrected an answer.`,
    );
  if (n('thumbs_down'))
    out.push(
      `${n('thumbs_down')} ${plural(n('thumbs_down'), 'person', 'people')} marked an answer unhelpful.`,
    );
  if (n('regenerate'))
    out.push(
      `${n('regenerate')} ${plural(n('regenerate'), 'person', 'people')} asked for a new answer.`,
    );
  if (n('edited_output'))
    out.push(
      `${n('edited_output')} ${plural(n('edited_output'), 'output was', 'outputs were')} edited before approval.`,
    );
  if (n('run_failed'))
    out.push(`${n('run_failed')} ${plural(n('run_failed'), 'run', 'runs')} failed.`);
  const known = new Set([
    'empty_search',
    'correction',
    'thumbs_down',
    'regenerate',
    'edited_output',
    'run_failed',
  ]);
  const other = Object.entries(counts)
    .filter(([k]) => !known.has(k))
    .reduce((a, [, v]) => a + v, 0);
  if (other) out.push(`${other} other ${plural(other, 'signal', 'signals')}.`);
  return out;
}

/** "Who it affects" in one sentence. */
export function affectsSentence(a: KnowledgeProposalAffected | null | undefined): string {
  const routines = a?.routines ?? [];
  let who: string;
  switch (a?.audience) {
    case 'team':
      who = `Everyone on ${a.teamName ? `the ${a.teamName} team` : 'the team'}`;
      break;
    case 'person':
      who = a.personName ? `Only ${a.personName}` : 'Only its owner';
      break;
    case 'org':
    default:
      who = 'Everyone in the organization';
  }
  if (routines.length === 0) return `${who}.`;
  const names = routines.map((r) => r.name).join(', ');
  return `${who}, through the ${plural(routines.length, 'routine', 'routines')} ${names}.`;
}

export function targetKindLabel(type: string): string {
  return type === 'routine' ? 'Routine prompt' : 'Memory';
}

/** Hash link for one piece of evidence. */
export function evidenceHref(
  link:
    | { type: 'session'; sessionId: string }
    | { type: 'routine_run'; routineId: string; runId: string | null }
    | null,
): string | null {
  if (!link) return null;
  if (link.type === 'session') return `#/chat/${link.sessionId}`;
  return '#/routines';
}
