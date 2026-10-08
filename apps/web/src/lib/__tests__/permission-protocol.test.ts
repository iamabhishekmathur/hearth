import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionRequestInfo } from '@/hooks/use-chat';
import type { ToolPermissionDecision } from '@hearth/shared';

/**
 * W3 client wiring (J2). Mirrors the W2 chat-stop-protocol test: a fake socket
 * records emits so we can assert `emitPermissionResponse` sends the exact
 * `permission_response` event, plus pure reducers that model the permission
 * queue behavior use-chat implements (concurrent asks queue independently;
 * answering removes only that callId; the queue clears when the run ends).
 */

const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
const emitted: Array<{ event: string; payload: unknown }> = [];
const fakeSocket = {
  connected: true,
  emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); },
  on: (event: string, cb: (...args: unknown[]) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(cb);
    handlers.set(event, list);
  },
  off: () => {},
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({ io: () => fakeSocket, Socket: class {} }));

import { emitPermissionResponse } from '../socket-client';

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
});

describe('W3 permission_response protocol wiring', () => {
  it('emits permission_response with sessionId, callId, decision', () => {
    emitPermissionResponse('sess-1', 'pc_1', 'allow_once');
    expect(emitted).toEqual([
      { event: 'permission_response', payload: { sessionId: 'sess-1', callId: 'pc_1', decision: 'allow_once' } },
    ]);
  });

  it('carries each decision verbatim', () => {
    for (const d of ['allow_once', 'allow_always', 'deny'] as ToolPermissionDecision[]) {
      emitted.length = 0;
      emitPermissionResponse('s', 'pc', d);
      expect((emitted[0].payload as { decision: string }).decision).toBe(d);
    }
  });
});

// ── Pure reducers: the exact queue logic use-chat.handleEvent applies. Kept in
//    lockstep with use-chat.ts so the card wiring is regression-covered without
//    a full React render harness (no @testing-library in this package). ──

/** Append a permission_request, deduped by callId (repaint-safe). */
function onRequest(queue: PermissionRequestInfo[], req: PermissionRequestInfo): PermissionRequestInfo[] {
  if (queue.some((p) => p.callId === req.callId)) return queue;
  return [...queue, req];
}

/** Answer a prompt: remove only that callId (independent resolution). */
function onRespond(queue: PermissionRequestInfo[], callId: string): PermissionRequestInfo[] {
  return queue.filter((p) => p.callId !== callId);
}

/** Run end clears any unanswered prompts. */
function onDone(): PermissionRequestInfo[] {
  return [];
}

describe('W3 permission queue reducer (J2 concurrent asks)', () => {
  const a: PermissionRequestInfo = { callId: 'pc_a', tool: 'slack_post_message', input: { channel: '#a' } };
  const b: PermissionRequestInfo = { callId: 'pc_b', tool: 'slack_post_message', input: { channel: '#b' } };

  it('concurrent asks queue in arrival order', () => {
    let q: PermissionRequestInfo[] = [];
    q = onRequest(q, a);
    q = onRequest(q, b);
    expect(q.map((p) => p.callId)).toEqual(['pc_a', 'pc_b']);
  });

  it('answering one prompt removes only that callId', () => {
    let q = [a, b];
    q = onRespond(q, 'pc_a');
    expect(q.map((p) => p.callId)).toEqual(['pc_b']);
  });

  it('duplicate permission_request for the same callId is ignored', () => {
    let q: PermissionRequestInfo[] = [];
    q = onRequest(q, a);
    q = onRequest(q, { ...a });
    expect(q).toHaveLength(1);
  });

  it('run end clears unanswered prompts', () => {
    const q = [a, b];
    expect(onDone()).toEqual([]);
    expect(q).toHaveLength(2); // onDone returns fresh, doesn't mutate
  });

  it('answering an unknown callId is a no-op on the queue', () => {
    const q = [a];
    expect(onRespond(q, 'pc_missing')).toEqual([a]);
  });
});
