import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

import {
  adminWeeklyLine,
  cardsDueForReminder,
  findUnownedAreas,
  impactLine,
  isRecentlyUpdated,
  ownerSummaryLine,
  reminderLine,
  DAY_MS,
  type WaitingCard,
} from './knowledge-notify.js';
import type { KnowledgeAdminSummary } from '@hearth/shared';

const NOW = new Date('2026-11-24T09:00:00Z');
const card = (over: Partial<WaitingCard> = {}): WaitingCard => ({
  id: Math.random().toString(36),
  targetType: 'memory',
  targetId: 'm1',
  targetName: 'Customer update steps',
  availableAt: new Date(NOW.getTime() - DAY_MS),
  remindedAt: null,
  ...over,
});

describe('ownerSummaryLine', () => {
  it('nothing waiting → null', () => {
    expect(ownerSummaryLine([])).toBeNull();
  });
  it('one target → names it', () => {
    expect(ownerSummaryLine([card()])).toBe('1 proposal for Customer update steps');
    expect(ownerSummaryLine([card(), card(), card()])).toBe(
      '3 proposals for Customer update steps',
    );
  });
  it('several targets → one line pointing at Review', () => {
    expect(
      ownerSummaryLine([card(), card({ targetId: 'm2' }), card({ targetType: 'routine' })]),
    ).toBe('3 proposals wait in Review');
  });
  it('same id but different type counts as two targets', () => {
    expect(ownerSummaryLine([card(), card({ targetType: 'routine' })])).toBe(
      '2 proposals wait in Review',
    );
  });
});

describe('reminders', () => {
  it('due only at ≥ 7 days and only when never reminded', () => {
    const six = card({ availableAt: new Date(NOW.getTime() - 6 * DAY_MS) });
    const seven = card({ availableAt: new Date(NOW.getTime() - 7 * DAY_MS) });
    const old = card({ availableAt: new Date(NOW.getTime() - 30 * DAY_MS) });
    const done = card({
      availableAt: new Date(NOW.getTime() - 30 * DAY_MS),
      remindedAt: new Date(NOW.getTime() - 20 * DAY_MS),
    });
    expect(cardsDueForReminder([six, seven, old, done], NOW).map((c) => c.id)).toEqual([
      seven.id,
      old.id,
    ]);
  });
  it('reminder text', () => {
    expect(reminderLine([])).toBeNull();
    expect(reminderLine([card()])).toBe('Waiting a week: Customer update steps');
    expect(reminderLine([card(), card()])).toBe('2 proposals have waited a week');
  });
});

describe('impactLine', () => {
  it('only when N ≥ 1', () => {
    expect(impactLine(0)).toBeNull();
    expect(impactLine(1)).toBe('Your input improved 1 thing this week.');
    expect(impactLine(4)).toBe('Your input improved 4 things this week.');
  });
});

describe('adminWeeklyLine', () => {
  const base: KnowledgeAdminSummary = {
    days: 7,
    since: NOW.toISOString(),
    changed: { approved: 0, edited: 0, rejected: 0 },
    waiting: { pending: 0, oldestDays: null },
    unowned: [],
  };
  it('nothing to say → null (rejections alone are not news)', () => {
    expect(adminWeeklyLine(base)).toBeNull();
    expect(
      adminWeeklyLine({ ...base, changed: { approved: 0, edited: 0, rejected: 3 } }),
    ).toBeNull();
  });
  it('summarises changed, waiting and unowned', () => {
    expect(
      adminWeeklyLine({
        ...base,
        changed: { approved: 2, edited: 1, rejected: 0 },
        waiting: { pending: 4, oldestDays: 9 },
        unowned: [
          {
            reason: 'team_no_lead',
            teamId: 't',
            teamName: 'Ops',
            memory: 1,
            routines: 0,
            items: [],
          },
        ],
      }),
    ).toBe('Knowledge this week: 3 changed · 4 wait (oldest 9 days) · 1 area has no owner');
    expect(adminWeeklyLine({ ...base, changed: { approved: 1, edited: 0, rejected: 0 } })).toBe(
      'Knowledge this week: 1 changed · none wait',
    );
    expect(adminWeeklyLine({ ...base, waiting: { pending: 1, oldestDays: 1 } })).toBe(
      'Knowledge this week: 0 changed · 1 waits (oldest 1 day)',
    );
  });
});

describe('isRecentlyUpdated', () => {
  it('a recent change (version > 1) within 7 days', () => {
    expect(isRecentlyUpdated(2, new Date(NOW.getTime() - DAY_MS), NOW)).toBe(true);
    expect(isRecentlyUpdated(5, new Date(NOW.getTime() - 7 * DAY_MS), NOW)).toBe(true);
  });
  it('not after 7 days', () => {
    expect(isRecentlyUpdated(2, new Date(NOW.getTime() - 7 * DAY_MS - 1000), NOW)).toBe(false);
  });
  it('the first version is creation, not an update', () => {
    expect(isRecentlyUpdated(1, new Date(NOW.getTime() - 1000), NOW)).toBe(false);
  });
  it('no version row → false', () => {
    expect(isRecentlyUpdated(3, null, NOW)).toBe(false);
  });
});

describe('findUnownedAreas', () => {
  const item = (over: Record<string, unknown>) => ({
    type: 'memory' as const,
    id: Math.random().toString(36),
    name: 'x',
    scope: 'team',
    teamId: 't1',
    ownerId: null as string | null,
    ...over,
  });
  const base = {
    orgUserIds: new Set(['u1', 'u2']),
    teamsWithLead: new Set(['t2']),
    teamNames: new Map([
      ['t1', 'Ops'],
      ['t2', 'Eng'],
    ]),
    adminCount: 1,
  };

  it('team items in a team with no lead → one area per team, counted by type', () => {
    const areas = findUnownedAreas({
      ...base,
      items: [
        item({}),
        item({}),
        item({ type: 'routine' }),
        item({ teamId: 't2' }), // has a lead
      ],
    });
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({
      reason: 'team_no_lead',
      teamId: 't1',
      teamName: 'Ops',
      memory: 2,
      routines: 1,
    });
    expect(areas[0].items).toHaveLength(3);
  });

  it('a valid explicit owner covers the item even in a team with no lead', () => {
    expect(findUnownedAreas({ ...base, items: [item({ ownerId: 'u1' })] })).toEqual([]);
  });

  it('an explicit owner who left the org → owner_left', () => {
    const areas = findUnownedAreas({
      ...base,
      items: [
        item({ ownerId: 'gone', teamId: 't2' }),
        item({ scope: 'org', teamId: null, ownerId: 'gone2' }),
      ],
    });
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ reason: 'owner_left', memory: 2 });
  });

  it('org items with no admin → no_admin; with an admin → owned', () => {
    const items = [item({ scope: 'org', teamId: null })];
    expect(findUnownedAreas({ ...base, items })).toEqual([]);
    expect(findUnownedAreas({ ...base, adminCount: 0, items })[0].reason).toBe('no_admin');
  });

  it('caps examples at 5 but keeps counting', () => {
    const areas = findUnownedAreas({ ...base, items: Array.from({ length: 8 }, () => item({})) });
    expect(areas[0].memory).toBe(8);
    expect(areas[0].items).toHaveLength(5);
  });
});
