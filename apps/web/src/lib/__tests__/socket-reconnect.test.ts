import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake socket.io client: records emits and lets the test fire events.
const handlers = new Map<string, Array<() => void>>();
const managerHandlers = new Map<string, Array<() => void>>();
const emitted: Array<{ event: string; payload: unknown }> = [];
const fakeSocket = {
  connected: false,
  emit: (event: string, payload: unknown) => {
    emitted.push({ event, payload });
  },
  on: (event: string, cb: () => void) => {
    handlers.set(event, [...(handlers.get(event) ?? []), cb]);
  },
  off: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  io: {
    on: (event: string, cb: () => void) => {
      managerHandlers.set(event, [...(managerHandlers.get(event) ?? []), cb]);
    },
  },
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket, Socket: class {} }));

import { getSocket, joinSession, leaveSession, onSocketReconnect } from '../socket-client';

const fire = (m: Map<string, Array<() => void>>, e: string) => (m.get(e) ?? []).forEach((h) => h());

describe('socket reconnect handling', () => {
  beforeEach(() => {
    emitted.length = 0;
    getSocket();
  });

  it('re-joins every open session room on each (re)connect', () => {
    fakeSocket.connected = false;
    joinSession('s1');
    joinSession('s2');
    expect(emitted).toEqual([]); // not connected yet

    fire(handlers, 'connect');
    expect(emitted.map((e) => e.payload).sort()).toEqual(['s1', 's2']);

    // Server restarts: the client reconnects and must re-join.
    emitted.length = 0;
    fire(handlers, 'connect');
    expect(emitted.map((e) => e.payload).sort()).toEqual(['s1', 's2']);
    leaveSession('s1');
    leaveSession('s2');
  });

  it('does not re-join a session that was left', () => {
    fakeSocket.connected = true;
    joinSession('s3');
    leaveSession('s3');
    emitted.length = 0;
    fire(handlers, 'connect');
    expect(emitted.filter((e) => e.event === 'join:session')).toEqual([]);
  });

  it('notifies reconnect listeners so open chats can re-sync', () => {
    const cb = vi.fn();
    const off = onSocketReconnect(cb);
    fire(managerHandlers, 'reconnect');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    fire(managerHandlers, 'reconnect');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
