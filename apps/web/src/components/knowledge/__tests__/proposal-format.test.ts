import { describe, it, expect } from 'vitest';
import { affectsSentence, evidenceHref, targetKindLabel, whySentences } from '../proposal-format';

describe('whySentences', () => {
  it('uses the mockup wording with plurals', () => {
    expect(whySentences({ empty_search: 3, correction: 2 })).toEqual([
      '3 agents flagged a gap.',
      '2 people corrected an answer.',
    ]);
  });

  it('uses singulars for one', () => {
    expect(
      whySentences({ empty_search: 1, correction: 1, run_failed: 1, edited_output: 1 }),
    ).toEqual([
      '1 agent flagged a gap.',
      '1 person corrected an answer.',
      '1 output was edited before approval.',
      '1 run failed.',
    ]);
  });

  it('keeps a fixed order regardless of key order', () => {
    expect(whySentences({ run_failed: 2, thumbs_down: 1, regenerate: 2 })).toEqual([
      '1 person marked an answer unhelpful.',
      '2 people asked for a new answer.',
      '2 runs failed.',
    ]);
  });

  it('groups unknown kinds', () => {
    expect(whySentences({ mystery: 2, other: 1 })).toEqual(['3 other signals.']);
  });

  it('no counts → no lines', () => {
    expect(whySentences({})).toEqual([]);
  });
});

describe('affectsSentence', () => {
  it('org', () => {
    expect(affectsSentence({ audience: 'org' })).toBe('Everyone in the organization.');
  });
  it('team, with and without a name', () => {
    expect(affectsSentence({ audience: 'team', teamName: 'Engineering' })).toBe(
      'Everyone on the Engineering team.',
    );
    expect(affectsSentence({ audience: 'team' })).toBe('Everyone on the team.');
  });
  it('person', () => {
    expect(affectsSentence({ audience: 'person', personName: 'Ada' })).toBe('Only Ada.');
    expect(affectsSentence({ audience: 'person' })).toBe('Only its owner.');
  });
  it('names the routines it changes', () => {
    expect(
      affectsSentence({
        audience: 'team',
        teamName: 'Support',
        routines: [{ id: 'r', name: 'Daily brief' }],
      }),
    ).toBe('Everyone on the Support team, through the routine Daily brief.');
    expect(
      affectsSentence({
        audience: 'org',
        routines: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      }),
    ).toBe('Everyone in the organization, through the routines A, B.');
  });
  it('missing data falls back to the org sentence', () => {
    expect(affectsSentence(null)).toBe('Everyone in the organization.');
  });
});

describe('evidenceHref / targetKindLabel', () => {
  it('links a chat to its session and a run to routines', () => {
    expect(evidenceHref({ type: 'session', sessionId: 's1' })).toBe('#/chat/s1');
    expect(evidenceHref({ type: 'routine_run', routineId: 'r1', runId: 'x' })).toBe('#/routines');
    expect(evidenceHref(null)).toBeNull();
  });
  it('labels the target kind', () => {
    expect(targetKindLabel('memory')).toBe('Memory');
    expect(targetKindLabel('routine')).toBe('Routine prompt');
  });
});
