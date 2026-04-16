import { describe, it, expect } from 'vitest';
import { VALID_STATUS_TRANSITIONS, type TaskStatus } from '@hearth/shared';

describe('Task status transitions', () => {
  it('auto_detected can go to backlog or archived', () => {
    expect(VALID_STATUS_TRANSITIONS.auto_detected).toContain('backlog');
    expect(VALID_STATUS_TRANSITIONS.auto_detected).toContain('archived');
    expect(VALID_STATUS_TRANSITIONS.auto_detected).not.toContain('done');
  });

  it('backlog can go to planning or archived', () => {
    expect(VALID_STATUS_TRANSITIONS.backlog).toContain('planning');
    expect(VALID_STATUS_TRANSITIONS.backlog).toContain('archived');
    expect(VALID_STATUS_TRANSITIONS.backlog).not.toContain('executing');
  });

  it('planning can go to executing, backlog, or archived', () => {
    expect(VALID_STATUS_TRANSITIONS.planning).toContain('executing');
    expect(VALID_STATUS_TRANSITIONS.planning).toContain('backlog');
    expect(VALID_STATUS_TRANSITIONS.planning).toContain('archived');
  });

  it('executing can go to review, failed, or archived', () => {
    expect(VALID_STATUS_TRANSITIONS.executing).toContain('review');
    expect(VALID_STATUS_TRANSITIONS.executing).toContain('failed');
    expect(VALID_STATUS_TRANSITIONS.executing).toContain('archived');
    expect(VALID_STATUS_TRANSITIONS.executing).not.toContain('done');
  });

  it('review can go to executing, done, or archived', () => {
    expect(VALID_STATUS_TRANSITIONS.review).toContain('executing');
    expect(VALID_STATUS_TRANSITIONS.review).toContain('done');
    expect(VALID_STATUS_TRANSITIONS.review).toContain('archived');
  });

  it('done can only go to archived', () => {
    expect(VALID_STATUS_TRANSITIONS.done).toEqual(['archived']);
  });

  it('failed can go to backlog, planning, or archived', () => {
    expect(VALID_STATUS_TRANSITIONS.failed).toContain('backlog');
    expect(VALID_STATUS_TRANSITIONS.failed).toContain('planning');
    expect(VALID_STATUS_TRANSITIONS.failed).toContain('archived');
  });

  it('archived has no transitions', () => {
    expect(VALID_STATUS_TRANSITIONS.archived).toEqual([]);
  });

  it('cannot skip from auto_detected to done', () => {
    expect(VALID_STATUS_TRANSITIONS.auto_detected).not.toContain('done');
  });

  it('cannot skip from auto_detected to executing', () => {
    expect(VALID_STATUS_TRANSITIONS.auto_detected).not.toContain('executing');
  });

  // Validate that the transition function works
  function canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return VALID_STATUS_TRANSITIONS[from].includes(to);
  }

  it('validates transitions correctly', () => {
    expect(canTransition('auto_detected', 'backlog')).toBe(true);
    expect(canTransition('auto_detected', 'done')).toBe(false);
    expect(canTransition('executing', 'review')).toBe(true);
    expect(canTransition('done', 'backlog')).toBe(false);
  });
});
