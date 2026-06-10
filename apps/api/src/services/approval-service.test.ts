import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    approvalRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../ws/socket-manager.js', () => ({
  emitToUser: vi.fn(),
}));

import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../ws/socket-manager.js';
import {
  createApprovalRequest,
  resolveApproval,
  handleApprovalTimeout,
  getPendingApprovalsForUser,
} from './approval-service.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function makePendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appr-1',
    status: 'pending',
    runId: 'run-1',
    checkpointId: 'cp-1',
    run: { id: 'run-1', routineId: 'routine-1' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── createApprovalRequest ──

describe('createApprovalRequest (APPR-H-01)', () => {
  it('creates a pending request and notifies the routine owner', async () => {
    asMock(prisma.approvalRequest.create).mockResolvedValue({
      id: 'appr-1',
      status: 'pending',
      checkpoint: { name: 'Send Email', routineId: 'routine-1' },
      run: { routine: { userId: 'owner-1', name: 'Daily Digest' } },
    });

    const result = await createApprovalRequest({
      runId: 'run-1',
      checkpointId: 'cp-1',
      agentOutput: 'draft output',
    });

    expect(result.id).toBe('appr-1');
    expect(asMock(prisma.approvalRequest.create).mock.calls[0][0].data).toEqual(
      expect.objectContaining({ runId: 'run-1', checkpointId: 'cp-1', status: 'pending' }),
    );
    expect(emitToUser).toHaveBeenCalledWith(
      'owner-1',
      'notification',
      expect.objectContaining({ type: 'approval_requested', entityId: 'appr-1' }),
    );
  });

  it('defaults agentOutput and timeoutAt to null when omitted', async () => {
    asMock(prisma.approvalRequest.create).mockResolvedValue({
      id: 'appr-2',
      checkpoint: { name: 'CP', routineId: 'r' },
      run: { routine: { userId: 'owner-1', name: 'R' } },
    });

    await createApprovalRequest({ runId: 'run-1', checkpointId: 'cp-1' });

    const data = asMock(prisma.approvalRequest.create).mock.calls[0][0].data;
    expect(data.agentOutput).toBeNull();
    expect(data.timeoutAt).toBeNull();
  });
});

// ── resolveApproval ──

describe('resolveApproval (APPR-H-02/03/04, APPR-E-02)', () => {
  it('approves a pending request and records the reviewer', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(makePendingRequest());
    asMock(prisma.approvalRequest.update).mockResolvedValue({
      id: 'appr-1',
      status: 'approved',
      reviewerId: 'reviewer-1',
      run: { id: 'run-1', routineId: 'routine-1' },
      checkpoint: { name: 'CP' },
    });

    const result = await resolveApproval('appr-1', 'reviewer-1', 'approved');

    expect(result).not.toBeNull();
    expect(result!.status).toBe('approved');
    const updateArg = asMock(prisma.approvalRequest.update).mock.calls[0][0];
    expect(updateArg.data).toEqual(
      expect.objectContaining({ status: 'approved', reviewerId: 'reviewer-1' }),
    );
    expect(updateArg.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('rejects with a comment (APPR-H-03)', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(makePendingRequest());
    asMock(prisma.approvalRequest.update).mockResolvedValue({ id: 'appr-1', status: 'rejected' });

    await resolveApproval('appr-1', 'reviewer-1', 'rejected', { comment: 'not safe' });

    expect(asMock(prisma.approvalRequest.update).mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'rejected', reviewerComment: 'not safe' }),
    );
  });

  it('persists an edited output on "edited" (APPR-H-04)', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(makePendingRequest());
    asMock(prisma.approvalRequest.update).mockResolvedValue({ id: 'appr-1', status: 'edited' });

    await resolveApproval('appr-1', 'reviewer-1', 'edited', { editedOutput: 'fixed text' });

    expect(asMock(prisma.approvalRequest.update).mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'edited', editedOutput: 'fixed text' }),
    );
  });

  it('returns null for a non-existent request', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(null);

    const result = await resolveApproval('missing', 'reviewer-1', 'approved');
    expect(result).toBeNull();
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });

  it('returns null when the request is already resolved (APPR-E-02, APPR-X-01 second writer)', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(
      makePendingRequest({ status: 'approved' }),
    );

    const result = await resolveApproval('appr-1', 'reviewer-2', 'rejected');
    expect(result).toBeNull();
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });

  // APPR-Z-01: in-org authorization (rule chosen 2026-06-09) — only the routine
  // OWNER or an org ADMIN may resolve. The check runs only when callerRole is
  // passed; the owner is read from run.routine.userId.
  const withOwner = (userId: string) =>
    makePendingRequest({ run: { id: 'run-1', routineId: 'routine-1', routine: { userId, orgId: 'org-1' } } });

  it('FIXED (APPR-Z-01): a non-owner non-admin caller is forbidden', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(withOwner('owner-1'));

    await expect(
      resolveApproval('appr-1', 'someone-else', 'approved', { callerRole: 'member' }),
    ).rejects.toThrow(/not authorized/i);
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });

  it('FIXED (APPR-Z-01): the routine owner may resolve', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(withOwner('owner-1'));
    asMock(prisma.approvalRequest.update).mockResolvedValue({ id: 'appr-1', status: 'approved', reviewerId: 'owner-1' });

    const result = await resolveApproval('appr-1', 'owner-1', 'approved', { callerRole: 'member' });
    expect(result!.status).toBe('approved');
    expect(prisma.approvalRequest.update).toHaveBeenCalledTimes(1);
  });

  it('FIXED (APPR-Z-01): an admin (non-owner) may resolve', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(withOwner('owner-1'));
    asMock(prisma.approvalRequest.update).mockResolvedValue({ id: 'appr-1', status: 'approved', reviewerId: 'an-admin' });

    const result = await resolveApproval('appr-1', 'an-admin', 'approved', { callerRole: 'admin' });
    expect(result!.status).toBe('approved');
    expect(prisma.approvalRequest.update).toHaveBeenCalledTimes(1);
  });
});

// ── handleApprovalTimeout ──

describe('handleApprovalTimeout (APPR-H-07/08, APPR-E-03)', () => {
  it('auto-approves a pending request', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(makePendingRequest());
    asMock(prisma.approvalRequest.update).mockResolvedValue({ id: 'appr-1', status: 'auto_approved' });

    await handleApprovalTimeout('appr-1', 'approve');

    expect(asMock(prisma.approvalRequest.update).mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'auto_approved' }),
    );
  });

  it('auto-rejects a pending request', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(makePendingRequest());
    asMock(prisma.approvalRequest.update).mockResolvedValue({ id: 'appr-1', status: 'auto_rejected' });

    await handleApprovalTimeout('appr-1', 'reject');

    expect(asMock(prisma.approvalRequest.update).mock.calls[0][0].data.status).toBe('auto_rejected');
  });

  it('is a no-op on an already-resolved request (APPR-E-03)', async () => {
    asMock(prisma.approvalRequest.findUnique).mockResolvedValue(
      makePendingRequest({ status: 'approved' }),
    );

    const result = await handleApprovalTimeout('appr-1', 'approve');
    expect(result).toBeNull();
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });
});

// ── getPendingApprovalsForUser ──

describe('getPendingApprovalsForUser (APPR-H-05, APPR-X-04)', () => {
  it('returns empty when the user does not exist', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);

    const result = await getPendingApprovalsForUser('ghost');
    expect(result).toEqual([]);
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });

  it('queries for own + org-level pending approvals (APPR-X-04)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      role: 'member',
      teamId: 'team-1',
      team: { orgId: 'org-1' },
    });
    asMock(prisma.approvalRequest.findMany).mockResolvedValue([]);

    await getPendingApprovalsForUser('user-1');

    const where = asMock(prisma.approvalRequest.findMany).mock.calls[0][0].where;
    expect(where.status).toBe('pending');
    expect(where.run.routine.OR).toEqual([
      { userId: 'user-1' },
      { orgId: 'org-1' },
    ]);
  });
});
