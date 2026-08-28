import { describe, it, expect } from 'vitest';
import { contextLandingHash } from '../invitations';

// contextLandingHash maps an accepted invite's context to the hash route the
// invitee should land on. A plain (null) invite falls back to /chat; contextual
// invites land directly in the artifact so the referral is immediately useful.
describe('contextLandingHash', () => {
  it('falls back to /chat for a plain (no-context) invite', () => {
    expect(contextLandingHash(null)).toBe('/chat');
  });

  it('lands a decision invite on the decision deep-link', () => {
    expect(contextLandingHash({ type: 'decision', id: 'd1' })).toBe('/decisions?id=d1');
  });

  it('lands a chat_session invite in that session', () => {
    expect(contextLandingHash({ type: 'chat_session', id: 's1' })).toBe('/chat/s1');
  });

  it('lands a task invite on the task deep-link', () => {
    expect(contextLandingHash({ type: 'task', id: 't1' })).toBe('/tasks?taskId=t1');
  });
});
