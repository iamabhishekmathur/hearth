import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    approvalCheckpoint: { findFirst: vi.fn(), create: vi.fn() },
    routine: { findUnique: vi.fn() },
  },
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('./delivery-service.js', () => ({ deliver: vi.fn() }));
vi.mock('./delivery-rule-engine.js', () => ({ evaluateDeliveryRules: vi.fn(() => []), applyTemplate: vi.fn() }));
vi.mock('./approval-service.js', () => ({ createApprovalRequest: vi.fn() }));

import { prisma } from '../lib/prisma.js';
import { findApprovalGate } from './routine-delivery.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('findApprovalGate', () => {
  it('returns an existing ApprovalCheckpoint row when one exists', async () => {
    asMock(prisma.approvalCheckpoint.findFirst).mockResolvedValue({ id: 'cp-existing', position: 0 });
    const gate = await findApprovalGate('r-1');
    expect(gate?.id).toBe('cp-existing');
    expect(asMock(prisma.routine.findUnique)).not.toHaveBeenCalled();
    expect(asMock(prisma.approvalCheckpoint.create)).not.toHaveBeenCalled();
  });

  it('MATERIALIZES a checkpoint row from the routine.checkpoints JSON when no row exists', async () => {
    // This is the bug the E2E run caught: routines author gates as a JSON array,
    // but the worker queried the (empty) ApprovalCheckpoint table → gate never fired.
    asMock(prisma.approvalCheckpoint.findFirst).mockResolvedValue(null);
    asMock(prisma.routine.findUnique).mockResolvedValue({
      checkpoints: [{ name: 'Before send', condition: 'always' }],
    });
    asMock(prisma.approvalCheckpoint.create).mockResolvedValue({ id: 'cp-new', name: 'Before send', position: 0 });

    const gate = await findApprovalGate('r-1');

    expect(gate?.id).toBe('cp-new');
    expect(asMock(prisma.approvalCheckpoint.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ routineId: 'r-1', name: 'Before send', position: 0 }) }),
    );
  });

  it('returns null for an ungated routine (no row, empty JSON)', async () => {
    asMock(prisma.approvalCheckpoint.findFirst).mockResolvedValue(null);
    asMock(prisma.routine.findUnique).mockResolvedValue({ checkpoints: [] });
    expect(await findApprovalGate('r-1')).toBeNull();
    expect(asMock(prisma.approvalCheckpoint.create)).not.toHaveBeenCalled();
  });

  it('picks the earliest checkpoint by position when several are authored', async () => {
    asMock(prisma.approvalCheckpoint.findFirst).mockResolvedValue(null);
    asMock(prisma.routine.findUnique).mockResolvedValue({
      checkpoints: [{ name: 'Second', position: 1 }, { name: 'First', position: 0 }],
    });
    asMock(prisma.approvalCheckpoint.create).mockResolvedValue({ id: 'cp-new' });
    await findApprovalGate('r-1');
    expect(asMock(prisma.approvalCheckpoint.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'First', position: 0 }) }),
    );
  });
});
