import { describe, it, expect, vi } from 'vitest';
import { ConnectionManager, type ConnectionEntry } from './connection-manager.js';

function entry(healthy: boolean | Error): ConnectionEntry {
  return {
    connector: {
      healthCheck: vi.fn(async () => {
        if (healthy instanceof Error) throw healthy;
        return healthy;
      }),
      connect: vi.fn(async () => {
        throw new Error('still down');
      }),
    } as unknown as ConnectionEntry['connector'],
    config: { provider: 'slack', credentials: {} },
    lastHealthCheck: null,
    healthy: true,
  };
}

describe('ConnectionManager background health checks', () => {
  it('reports every outcome so it can be persisted', async () => {
    const cm = new ConnectionManager();
    const seen: Array<[string, boolean]> = [];
    cm.onHealthResult = async (id, healthy, at) => {
      expect(at).toBeInstanceOf(Date);
      seen.push([id, healthy]);
    };
    const map = (cm as unknown as { connections: Map<string, ConnectionEntry> }).connections;
    map.set('ok', entry(true));
    map.set('down', entry(false));
    map.set('throws', entry(new Error('boom')));

    await cm.runHealthChecks();

    expect(seen).toEqual([
      ['ok', true],
      ['down', false],
      ['throws', false],
    ]);
  });

  it('keeps checking other connections when persisting one fails', async () => {
    const cm = new ConnectionManager();
    const calls: string[] = [];
    cm.onHealthResult = async (id) => {
      calls.push(id);
      throw new Error('db down');
    };
    const map = (cm as unknown as { connections: Map<string, ConnectionEntry> }).connections;
    map.set('a', entry(true));
    map.set('b', entry(true));

    await expect(cm.runHealthChecks()).resolves.toBeUndefined();
    expect(calls).toEqual(['a', 'b']);
  });
});
