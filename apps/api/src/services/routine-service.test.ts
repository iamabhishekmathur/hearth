import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    routine: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    routineRun: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';
import * as routineService from './routine-service.js';

describe('routine-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRoutines', () => {
    it('queries routines for a given user', async () => {
      const mockRoutines = [{ id: 'r1', name: 'Test', userId: 'u1' }];
      (prisma.routine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockRoutines);

      const result = await routineService.listRoutines('u1');

      expect(prisma.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
      expect(result).toEqual(mockRoutines);
    });
  });

  describe('createRoutine', () => {
    it('creates a routine with default delivery', async () => {
      const mockRoutine = { id: 'r1', name: 'Test', enabled: true };
      (prisma.routine.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockRoutine);

      const result = await routineService.createRoutine('u1', {
        name: 'Test',
        prompt: 'Do something',
        schedule: '0 9 * * *',
      });

      expect(prisma.routine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            name: 'Test',
            prompt: 'Do something',
            schedule: '0 9 * * *',
            enabled: true,
          }),
        }),
      );
      expect(result).toEqual(mockRoutine);
    });
  });

  describe('toggleRoutine', () => {
    it('toggles enabled state', async () => {
      (prisma.routine.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1', enabled: true });
      (prisma.routine.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1', enabled: false });

      const result = await routineService.toggleRoutine('r1', 'u1');

      expect(prisma.routine.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { enabled: false } }),
      );
      expect(result?.enabled).toBe(false);
    });

    it('returns null for non-existent routine', async () => {
      (prisma.routine.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await routineService.toggleRoutine('nonexistent', 'u1');
      expect(result).toBeNull();
    });
  });

  describe('deleteRoutine', () => {
    it('deletes runs then routine', async () => {
      (prisma.routine.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1' });
      (prisma.routineRun.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });
      (prisma.routine.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r1' });

      const result = await routineService.deleteRoutine('r1', 'u1');

      expect(prisma.routineRun.deleteMany).toHaveBeenCalledWith({ where: { routineId: 'r1' } });
      expect(prisma.routine.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(result).toBeTruthy();
    });
  });
});
