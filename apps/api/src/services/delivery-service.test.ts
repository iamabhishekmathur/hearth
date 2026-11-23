import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    integration: { findFirst: vi.fn() },
  },
}));
vi.mock('../ws/socket-manager.js', () => ({ emitToUser: vi.fn() }));
vi.mock('./slack-service.js', () => ({ postMessage: vi.fn() }));
vi.mock('./email-service.js', () => ({ isEmailConfigured: vi.fn(() => false), sendEmail: vi.fn() }));
vi.mock('./notification-service.js', () => ({ notify: vi.fn() }));
vi.mock('../mcp/token-store.js', () => ({ decrypt: vi.fn((s: string) => s) }));

import { prisma } from '../lib/prisma.js';
import * as notificationService from './notification-service.js';
import { deliver } from './delivery-service.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('delivery-service in_app channel', () => {
  it('writes a real Notification row via notify() for a routine result', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({ team: { orgId: 'org-1' } });

    await deliver({
      userId: 'u-1',
      title: 'Routine completed: Morning brief',
      body: 'Here is your brief',
      entityType: 'routine',
      entityId: 'r-1',
      channels: ['in_app'],
      metadata: { runId: 'run-1' },
    });

    expect(asMock(notificationService.notify)).toHaveBeenCalledTimes(1);
    expect(asMock(notificationService.notify)).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        userId: 'u-1',
        type: 'routine_result',
        title: 'Routine completed: Morning brief',
        body: 'Here is your brief',
        entityType: 'routine',
        entityId: 'r-1',
        sessionId: undefined,
      }),
    );
  });

  it('uses the supplied orgId without an extra user lookup', async () => {
    await deliver({
      userId: 'u-2',
      title: 'Done',
      body: 'body',
      entityType: 'routine',
      entityId: 'r-2',
      channels: ['in_app'],
      orgId: 'org-2',
    });

    expect(asMock(prisma.user.findUnique)).not.toHaveBeenCalled();
    expect(asMock(notificationService.notify)).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-2', type: 'routine_result' }),
    );
  });

  it('honors a custom notificationType (e.g. digest)', async () => {
    await deliver({
      userId: 'u-3',
      title: 'Digest',
      body: 'summary',
      entityType: 'org',
      entityId: 'org-3',
      channels: ['in_app'],
      orgId: 'org-3',
      notificationType: 'digest',
    });

    expect(asMock(notificationService.notify)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'digest' }),
    );
  });

  it('skips the Notification row (best-effort) when orgId cannot be resolved', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);

    await deliver({
      userId: 'u-4',
      title: 'Orphan',
      body: 'body',
      entityType: 'routine',
      entityId: 'r-4',
      channels: ['in_app'],
    });

    expect(asMock(notificationService.notify)).not.toHaveBeenCalled();
  });
});
