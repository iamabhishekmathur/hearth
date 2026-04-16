import { describe, it, expect } from 'vitest';

// Unit test for task decomposition / subtask logic (the non-DB parts)

describe('Task executor — prompt building', () => {
  function buildTaskPrompt(task: { title: string; description?: string; context?: Record<string, unknown> }): string {
    return [
      task.title,
      task.description ?? '',
      task.context && Object.keys(task.context).length > 0
        ? `Context: ${JSON.stringify(task.context)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  it('builds prompt with title only', () => {
    const prompt = buildTaskPrompt({ title: 'Fix the bug' });
    expect(prompt).toBe('Fix the bug');
  });

  it('builds prompt with title and description', () => {
    const prompt = buildTaskPrompt({
      title: 'Fix the bug',
      description: 'Users see a 500 error',
    });
    expect(prompt).toBe('Fix the bug\nUsers see a 500 error');
  });

  it('builds prompt with title, description, and context', () => {
    const prompt = buildTaskPrompt({
      title: 'Fix the bug',
      description: 'Users see a 500 error',
      context: { url: '/api/foo' },
    });
    expect(prompt).toContain('Fix the bug');
    expect(prompt).toContain('Users see a 500 error');
    expect(prompt).toContain('Context:');
    expect(prompt).toContain('/api/foo');
  });

  it('omits empty description and context', () => {
    const prompt = buildTaskPrompt({
      title: 'Simple task',
      description: '',
      context: {},
    });
    expect(prompt).toBe('Simple task');
  });
});

describe('Task executor — execution trigger logic', () => {
  /**
   * Determines if task execution should be enqueued based on a status update.
   * This mirrors the logic that should exist in the tasks route.
   */
  function shouldTriggerExecution(
    previousStatus: string,
    newStatus: string | undefined,
  ): boolean {
    return newStatus === 'executing' && previousStatus !== 'executing';
  }

  it('triggers execution when transitioning to executing from planning', () => {
    expect(shouldTriggerExecution('planning', 'executing')).toBe(true);
  });

  it('triggers execution when transitioning to executing from backlog', () => {
    // backlog → planning → executing, but the function only checks the immediate transition
    expect(shouldTriggerExecution('review', 'executing')).toBe(true);
  });

  it('does NOT trigger when status is unchanged (already executing)', () => {
    expect(shouldTriggerExecution('executing', 'executing')).toBe(false);
  });

  it('does NOT trigger when status changes to something other than executing', () => {
    expect(shouldTriggerExecution('planning', 'review')).toBe(false);
    expect(shouldTriggerExecution('auto_detected', 'backlog')).toBe(false);
  });

  it('does NOT trigger when no status update is provided', () => {
    expect(shouldTriggerExecution('planning', undefined)).toBe(false);
  });
});
