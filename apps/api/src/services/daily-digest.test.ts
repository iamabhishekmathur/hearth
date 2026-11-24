import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379', WEB_URL: 'https://app.hearth.test' },
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    org: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { findMany: vi.fn(async () => []) },
    notificationPreference: { findMany: vi.fn(async () => []) },
    knowledgeProposal: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
  },
}));
vi.mock('./activity-feed-service.js', () => ({ generateDigest: vi.fn() }));
vi.mock('./notification-service.js', () => ({ notify: vi.fn() }));
vi.mock('./email-service.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

import { prisma } from '../lib/prisma.js';
import * as notificationService from './notification-service.js';
import * as emailService from './email-service.js';
import {
  composeDigest,
  escapeHtml,
  localTime,
  runDailyDigest,
  timezoneOf,
  DEFAULT_TIMEZONE,
} from './daily-digest.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
// Monday 2026-11-23, 09:00 UTC.
const NINE_UTC = new Date('2026-11-23T09:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.notification.findMany).mockResolvedValue([]);
});

describe('timezoneOf', () => {
  it('reads an IANA timezone from preferences', () => {
    expect(timezoneOf({ timezone: 'America/Toronto' })).toBe('America/Toronto');
  });
  it('defaults to UTC with no preferences, no timezone, or an invalid one', () => {
    expect(DEFAULT_TIMEZONE).toBe('UTC');
    expect(timezoneOf(null)).toBe('UTC');
    expect(timezoneOf({})).toBe('UTC');
    expect(timezoneOf({ timezone: 42 })).toBe('UTC');
    expect(timezoneOf({ timezone: 'Not/AZone' })).toBe('UTC');
  });
});

describe('localTime', () => {
  it('gives the local hour and weekday', () => {
    expect(localTime('UTC', NINE_UTC)).toEqual({ hour: 9, weekday: 'Mon' });
    // Toronto is UTC-5 in November.
    expect(localTime('America/Toronto', NINE_UTC)).toEqual({ hour: 4, weekday: 'Mon' });
    // Tokyo is UTC+9: 18:00 Monday.
    expect(localTime('Asia/Tokyo', NINE_UTC)).toEqual({ hour: 18, weekday: 'Mon' });
  });
  it('midnight is hour 0, not 24', () => {
    expect(localTime('UTC', new Date('2026-11-23T00:00:00Z')).hour).toBe(0);
  });
});

describe('composeDigest', () => {
  it('nothing to say → null', () => {
    expect(composeDigest({ orgName: 'Acme', activity: null, knowledgeLines: [] })).toBeNull();
    expect(composeDigest({ orgName: 'Acme', activity: null, knowledgeLines: ['  '] })).toBeNull();
  });
  it('activity only → the classic digest that opens the org', () => {
    expect(composeDigest({ orgName: 'Acme', activity: 'Busy day', knowledgeLines: [] })).toEqual({
      title: 'Daily Activity Digest — Acme',
      body: 'Busy day',
      entityType: 'org',
    });
  });
  it('knowledge only → the first line is the title and it opens Review', () => {
    expect(
      composeDigest({
        orgName: 'Acme',
        activity: null,
        knowledgeLines: ['3 proposals wait in Review', 'Waiting a week: X'],
      }),
    ).toEqual({
      title: '3 proposals wait in Review',
      body: 'Waiting a week: X',
      entityType: 'review',
    });
  });
  it('both → ONE item, knowledge first in the body', () => {
    const d = composeDigest({
      orgName: 'Acme',
      activity: 'Busy day',
      knowledgeLines: ['2 proposals for Y'],
    })!;
    expect(d.title).toBe('Daily Activity Digest — Acme');
    expect(d.body).toBe('2 proposals for Y\n\nBusy day');
    expect(d.entityType).toBe('review');
  });
});

describe('escapeHtml', () => {
  it('escapes markup', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('runDailyDigest (mocked db)', () => {
  const org = { id: 'org-1', name: 'Acme', settings: {} };
  const member = (id: string, tz?: string) => ({
    id,
    email: `${id}@x.test`,
    name: id,
    role: 'member',
    teamId: 't1',
    preferences: tz ? { timezone: tz } : {},
  });

  it('delivers only to people at 9am local, one item each', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([org]);
    asMock(prisma.user.findMany).mockResolvedValue([member('a'), member('b', 'Asia/Tokyo')]);
    const res = await runDailyDigest({
      now: NINE_UTC,
      activityDigest: async () => ({ summary: '3 decisions made', eventCount: 3 }),
    });
    expect(asMock(notificationService.notify)).toHaveBeenCalledTimes(1);
    expect(asMock(notificationService.notify)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'a',
        type: 'digest',
        body: '3 decisions made',
        entityType: 'org',
        createdAt: NINE_UTC,
      }),
    );
    expect(res[0].delivered).toBe(1);
  });

  it('nobody at 9am → no activity summary is generated (no LLM call)', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([org]);
    asMock(prisma.user.findMany).mockResolvedValue([member('b', 'Asia/Tokyo')]);
    const gen = vi.fn();
    await runDailyDigest({ now: NINE_UTC, activityDigest: gen });
    expect(gen).not.toHaveBeenCalled();
    expect(asMock(notificationService.notify)).not.toHaveBeenCalled();
  });

  it('no activity and the flag off → nothing is sent', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([org]);
    asMock(prisma.user.findMany).mockResolvedValue([member('a')]);
    await runDailyDigest({
      now: NINE_UTC,
      activityDigest: async () => ({ summary: '', eventCount: 0 }),
    });
    expect(asMock(notificationService.notify)).not.toHaveBeenCalled();
  });

  it('a retry in the same window does not send a second digest', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([org]);
    asMock(prisma.user.findMany).mockResolvedValue([member('a')]);
    asMock(prisma.notification.findMany).mockResolvedValue([{ userId: 'a' }]);
    await runDailyDigest({
      now: NINE_UTC,
      activityDigest: async () => ({ summary: 'x', eventCount: 1 }),
    });
    expect(asMock(notificationService.notify)).not.toHaveBeenCalled();
  });

  it('emails the activity part with a link when email is configured', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([org]);
    asMock(prisma.user.findMany).mockResolvedValue([member('a')]);
    asMock(emailService.isEmailConfigured).mockReturnValue(true);
    await runDailyDigest({
      now: NINE_UTC,
      activityDigest: async () => ({ summary: '<b>stuff</b>', eventCount: 1 }),
    });
    expect(asMock(emailService.sendEmail)).toHaveBeenCalledTimes(1);
    const arg = asMock(emailService.sendEmail).mock.calls[0][0];
    expect(arg.to).toBe('a@x.test');
    expect(arg.text).toContain('https://app.hearth.test/activity');
    expect(arg.html).toContain('&lt;b&gt;stuff&lt;/b&gt;');
  });

  it('a failing activity summary does not stop the run', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([org]);
    asMock(prisma.user.findMany).mockResolvedValue([member('a')]);
    const res = await runDailyDigest({
      now: NINE_UTC,
      activityDigest: async () => {
        throw new Error('llm down');
      },
    });
    expect(res[0].delivered).toBe(0);
  });
});
