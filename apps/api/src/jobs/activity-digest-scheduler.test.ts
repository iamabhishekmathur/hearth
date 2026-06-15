import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the processor fn handed to `new Worker(name, processor, opts)` so we
// can drive the digest job directly without a live Redis/BullMQ runtime.
let capturedProcessor: ((job: { data: { orgId?: string } }) => Promise<unknown>) | null = null;

vi.mock('bullmq', () => ({
  Queue: function () {
    return {
      add: vi.fn(),
      getRepeatableJobs: vi.fn().mockResolvedValue([]),
      removeRepeatableByKey: vi.fn(),
      close: vi.fn(),
    };
  },
  Worker: function (_name: string, processor: never) {
    capturedProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  },
}));

vi.mock('../config.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379', WEB_URL: 'https://app.hearth.test' },
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    org: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('../services/activity-feed-service.js', () => ({ generateDigest: vi.fn() }));
vi.mock('../services/notification-service.js', () => ({ notify: vi.fn() }));
vi.mock('../services/email-service.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

import { prisma } from '../lib/prisma.js';
import { generateDigest } from '../services/activity-feed-service.js';
import * as notificationService from '../services/notification-service.js';
import * as emailService from '../services/email-service.js';
import { createActivityDigestWorker } from './activity-digest-scheduler.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  capturedProcessor = null;
});

describe('activity digest worker', () => {
  it('writes a digest Notification row per eligible (9am) user', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([{ id: 'org-1', name: 'Acme' }]);
    asMock(generateDigest).mockResolvedValue({ summary: '3 decisions made', eventCount: 3 });
    // member-1 is at 9am local; member-2 is not → only member-1 gets a digest.
    asMock(prisma.user.findMany).mockResolvedValue([
      { id: 'm-1', email: 'a@x.test', name: 'A', preferences: { timezone: 'UTC' } },
      { id: 'm-2', email: 'b@x.test', name: 'B', preferences: { timezone: 'UTC' } },
    ]);

    // Force getUserLocalHour to think it's 9am for everyone by stubbing Date.
    const realToLocale = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function () {
      return '9';
    } as never;

    try {
      createActivityDigestWorker();
      expect(capturedProcessor).toBeTypeOf('function');
      await capturedProcessor!({ data: {} });
    } finally {
      Date.prototype.toLocaleString = realToLocale;
    }

    expect(asMock(notificationService.notify)).toHaveBeenCalledTimes(2);
    expect(asMock(notificationService.notify)).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        userId: 'm-1',
        type: 'digest',
        body: '3 decisions made',
        entityType: 'org',
        entityId: 'org-1',
      }),
    );
  });

  it('does not send re-engagement email when email is not configured', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([{ id: 'org-1', name: 'Acme' }]);
    asMock(generateDigest).mockResolvedValue({ summary: 'stuff', eventCount: 1 });
    asMock(prisma.user.findMany).mockResolvedValue([
      { id: 'm-1', email: 'a@x.test', name: 'A', preferences: { timezone: 'UTC' } },
    ]);
    asMock(emailService.isEmailConfigured).mockReturnValue(false);

    const realToLocale = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function () {
      return '9';
    } as never;
    try {
      createActivityDigestWorker();
      await capturedProcessor!({ data: {} });
    } finally {
      Date.prototype.toLocaleString = realToLocale;
    }

    expect(asMock(emailService.sendEmail)).not.toHaveBeenCalled();
    expect(asMock(notificationService.notify)).toHaveBeenCalledTimes(1);
  });

  it('sends a gated re-engagement email with a link when email is configured', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([{ id: 'org-1', name: 'Acme' }]);
    asMock(generateDigest).mockResolvedValue({ summary: 'stuff', eventCount: 1 });
    asMock(prisma.user.findMany).mockResolvedValue([
      { id: 'm-1', email: 'a@x.test', name: 'A', preferences: { timezone: 'UTC' } },
    ]);
    asMock(emailService.isEmailConfigured).mockReturnValue(true);

    const realToLocale = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function () {
      return '9';
    } as never;
    try {
      createActivityDigestWorker();
      await capturedProcessor!({ data: {} });
    } finally {
      Date.prototype.toLocaleString = realToLocale;
    }

    expect(asMock(emailService.sendEmail)).toHaveBeenCalledTimes(1);
    const arg = asMock(emailService.sendEmail).mock.calls[0][0];
    expect(arg.to).toBe('a@x.test');
    expect(arg.text).toContain('https://app.hearth.test/activity');
  });

  it('skips delivery entirely when there is no activity', async () => {
    asMock(prisma.org.findMany).mockResolvedValue([{ id: 'org-1', name: 'Acme' }]);
    asMock(generateDigest).mockResolvedValue({ summary: '', eventCount: 0 });

    createActivityDigestWorker();
    await capturedProcessor!({ data: {} });

    expect(asMock(prisma.user.findMany)).not.toHaveBeenCalled();
    expect(asMock(notificationService.notify)).not.toHaveBeenCalled();
  });
});
