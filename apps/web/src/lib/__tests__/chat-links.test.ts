import { describe, it, expect } from 'vitest';
import { sessionIdFromHash } from '../chat-links';

describe('sessionIdFromHash', () => {
  it('reads the task-panel query form', () => {
    expect(sessionIdFromHash('#/chat?sessionId=abc&messageId=m1')).toBe('abc');
  });
  it('reads the path form used by governance links', () => {
    expect(sessionIdFromHash('#/chat/d2a1fb28-6c56')).toBe('d2a1fb28-6c56');
  });
  it('returns null for the plain chat route and other pages', () => {
    expect(sessionIdFromHash('#/chat')).toBeNull();
    expect(sessionIdFromHash('#/settings/ai-plan')).toBeNull();
    expect(sessionIdFromHash('')).toBeNull();
  });
});
