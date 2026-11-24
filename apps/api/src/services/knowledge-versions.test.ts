import { describe, it, expect } from 'vitest';
import type { Routine } from '@prisma/client';
import {
  changesRoutineDefinition,
  isVersionedLayer,
  routineSnapshot,
  ROUTINE_SNAPSHOT_KEYS,
} from './knowledge-versions.js';

function makeRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'r-1',
    userId: 'u-1',
    name: 'Weekly customer update',
    description: null,
    prompt: 'Post the update in #customer',
    schedule: '0 9 * * 1',
    context: {},
    delivery: { channels: ['in_app'] },
    enabled: true,
    lastRunAt: null,
    lastRunStatus: null,
    createdVia: 'manual',
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
    state: { lastCursor: 'abc' },
    stateConfig: {},
    scope: 'team',
    teamId: 't-1',
    orgId: 'o-1',
    parameters: [],
    checkpoints: [],
    version: 1,
    ownerId: null,
    ...overrides,
  } as Routine;
}

describe('isVersionedLayer', () => {
  it('versions org, team and user memory, not session notes', () => {
    expect(isVersionedLayer('org')).toBe(true);
    expect(isVersionedLayer('team')).toBe(true);
    expect(isVersionedLayer('user')).toBe(true);
    expect(isVersionedLayer('session')).toBe(false);
  });
});

describe('routineSnapshot', () => {
  it('holds exactly the definition fields', () => {
    const snap = routineSnapshot(makeRoutine());
    expect(Object.keys(snap).sort()).toEqual([...ROUTINE_SNAPSHOT_KEYS].sort());
  });

  it('leaves out run state, enable flag and run metadata', () => {
    const snap = routineSnapshot(makeRoutine()) as unknown as Record<string, unknown>;
    for (const k of [
      'state',
      'enabled',
      'lastRunAt',
      'lastRunStatus',
      'version',
      'ownerId',
      'userId',
    ]) {
      expect(snap).not.toHaveProperty(k);
    }
  });
});

describe('changesRoutineDefinition', () => {
  const before = makeRoutine();

  it('is true for a prompt change', () => {
    expect(
      changesRoutineDefinition(before, { prompt: 'Post the update in #customer-updates' }),
    ).toBe(true);
  });

  it('is false when the new value equals the old value', () => {
    expect(changesRoutineDefinition(before, { prompt: before.prompt, name: before.name })).toBe(
      false,
    );
  });

  it('is false for run state and enable/disable', () => {
    expect(changesRoutineDefinition(before, { state: { lastCursor: 'xyz' } })).toBe(false);
    expect(changesRoutineDefinition(before, { enabled: false })).toBe(false);
  });

  it('ignores undefined fields (not sent)', () => {
    expect(changesRoutineDefinition(before, { prompt: undefined, schedule: undefined })).toBe(
      false,
    );
  });

  it('compares JSON fields by value, not identity', () => {
    expect(changesRoutineDefinition(before, { delivery: { channels: ['in_app'] } })).toBe(false);
    expect(changesRoutineDefinition(before, { delivery: { channels: ['slack'] } })).toBe(true);
  });

  it('treats clearing a description as a change', () => {
    const withDesc = makeRoutine({ description: 'old' });
    expect(changesRoutineDefinition(withDesc, { description: null })).toBe(true);
  });

  it('treats a scope move as a change', () => {
    expect(changesRoutineDefinition(before, { scope: 'org' })).toBe(true);
  });
});
