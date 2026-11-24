import { describe, it, expect } from 'vitest';
import {
  checkOutput,
  cleanPhrases,
  containsPhrase,
  derivePhrases,
  findRemovedPhrases,
  normalizeForMatch,
  MAX_DERIVED_PHRASES,
  MAX_DERIVED_PHRASE_CHARS,
} from './routine-test-cases.js';

describe('normalizeForMatch / containsPhrase', () => {
  it('ignores case, curly quotes and runs of white space', () => {
    expect(normalizeForMatch('  Yesterday’s   “Tickets”\n')).toBe('yesterday\'s "tickets"');
    expect(containsPhrase("Summarise yesterday's tickets", 'YESTERDAY’S  tickets')).toBe(true);
  });

  it('an empty phrase never matches', () => {
    expect(containsPhrase('anything', '   ')).toBe(false);
  });
});

describe('derivePhrases', () => {
  it('takes the words a fix added, split at punctuation, filler trimmed', () => {
    const before = 'Summarise yesterday’s customer tickets.';
    const after =
      'Summarise yesterday’s customer tickets from the Support queue (use ticket_lookup).';
    expect(derivePhrases(before, after)).toEqual(['Support queue', 'ticket_lookup']);
  });

  it('catches a changed word (a channel rename)', () => {
    const before = 'Weekly customer updates are posted in #customers every Friday.';
    const after = 'Weekly customer updates are posted in #customer-updates every Friday.';
    expect(derivePhrases(before, after)).toEqual(['#customer-updates']);
  });

  it('a fix that only removes text yields nothing', () => {
    expect(derivePhrases('Do A. Then do B. Then do C.', 'Do A. Then do C.')).toEqual([]);
  });

  it('is deterministic and every phrase is a piece of the fixed prompt', () => {
    const before = 'List open bugs.';
    const after =
      'List open bugs in Jira project HEARTH. Group them by priority; mention the owner of each bug.';
    const a = derivePhrases(before, after);
    const b = derivePhrases(before, after);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const p of a) expect(containsPhrase(after, p)).toBe(true);
    // The fixed prompt passes its own guard.
    expect(
      findRemovedPhrases([{ id: 't', description: 'd', mustContain: a }], after, after),
    ).toEqual([]);
  });

  it('keeps at most 5 phrases of at most 60 characters, cut at a word', () => {
    const after = Array.from({ length: 9 }, (_, i) => `Rule number ${i} applies here`).join('. ');
    const phrases = derivePhrases('', after);
    expect(phrases.length).toBe(MAX_DERIVED_PHRASES);
    const long = derivePhrases('x', 'x ' + 'supercalifragilistic expialidocious '.repeat(6).trim());
    expect(long).toHaveLength(1);
    expect(long[0].length).toBeLessThanOrEqual(MAX_DERIVED_PHRASE_CHARS);
    expect(long[0].endsWith(' ')).toBe(false);
  });

  it('ignores case and edge punctuation when matching words', () => {
    expect(derivePhrases('Post to Slack.', 'post to slack')).toEqual([]);
  });

  it('keeps file names, times and URLs whole', () => {
    const p = derivePhrases(
      'Read the report.',
      'Read the report at https://x.io/a.csv by 9:30 daily.',
    );
    expect(p).toContain('https://x.io/a.csv by 9:30 daily');
  });

  it('drops pieces that are only filler or too short', () => {
    expect(derivePhrases('Do it.', 'Do it, and then also the.')).toEqual([]);
  });

  it('falls back to new words for very long prompts', () => {
    const before = Array.from({ length: 2500 }, (_, i) => `w${i}`).join(' ');
    const after = `${before} zebracorn`;
    expect(derivePhrases(before, after)).toEqual(['zebracorn']);
  });
});

describe('findRemovedPhrases (the guard)', () => {
  const cases = [
    { id: 'c1', description: 'Uses the Support queue', mustContain: ['Support queue'] },
    { id: 'c2', description: 'Output mentions totals', mustContain: ['Total:'] },
  ];
  const current = 'Summarise tickets from the Support queue.';

  it('blocks a change that drops a phrase the prompt has, with a reason', () => {
    const f = findRemovedPhrases(cases, current, 'Summarise tickets.');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ testCaseId: 'c1', missing: ['Support queue'] });
    expect(f[0].reason).toContain('"Support queue"');
  });

  it('a phrase meant for the output (not in the prompt) never blocks an edit', () => {
    expect(findRemovedPhrases(cases, current, 'Summarise tickets from the Support queue!')).toEqual(
      [],
    );
  });

  it('keeping the phrase in another case or spacing passes', () => {
    expect(findRemovedPhrases(cases, current, 'Use the SUPPORT   queue only.')).toEqual([]);
  });

  it('lists every missing phrase of a case', () => {
    const f = findRemovedPhrases(
      [{ id: 'c', description: 'd', mustContain: ['alpha', 'beta', 'gamma'] }],
      'alpha beta gamma',
      'gamma',
    );
    expect(f[0].missing).toEqual(['alpha', 'beta']);
    expect(f[0].reason).toBe('The new prompt no longer says "alpha", "beta".');
  });

  it('tolerates junk in mustContain', () => {
    expect(
      findRemovedPhrases([{ id: 'c', description: 'd', mustContain: [1, null, ''] }], 'a', 'b'),
    ).toEqual([]);
    expect(findRemovedPhrases([{ id: 'c', description: 'd', mustContain: 'x' }], 'x', 'y')).toEqual(
      [],
    );
  });
});

describe('checkOutput', () => {
  it('passes a case when the output has every phrase', () => {
    const r = checkOutput(
      [
        { id: 'a', description: 'A', mustContain: ['Support queue', 'Total'] },
        { id: 'b', description: 'B', mustContain: ['ticket_lookup'] },
      ],
      'From the support QUEUE: 3 tickets. Total 3.',
    );
    expect(r).toEqual([
      { testCaseId: 'a', description: 'A', passed: true, missing: [] },
      { testCaseId: 'b', description: 'B', passed: false, missing: ['ticket_lookup'] },
    ]);
  });
});

describe('cleanPhrases', () => {
  it('trims, collapses spaces and drops repeats', () => {
    expect(cleanPhrases([' a  b ', 'A B', '', 'c'])).toEqual(['a b', 'c']);
  });
});
