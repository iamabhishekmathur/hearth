import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const h = vi.hoisted(() => ({
  seen: [] as Array<{ event: string; ctx: unknown }>,
  user: { name: 'Member', team: { orgId: 'org-a' } } as unknown,
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// tenant-context imports prisma.js, so resolve it lazily (at call time) to
// avoid a circular wait on this mock's own factory.
const ctxNow = async () => (await import('../lib/tenant-context.js')).getTenant();
vi.mock('../lib/prisma.js', () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(async () => h.user),
        findFirst: vi.fn(async () => {
          h.seen.push({ event: 'join:org', ctx: await ctxNow() });
          return { team: { orgId: 'org-a' } };
        }),
      },
      task: {
        findFirst: vi.fn(async () => {
          h.seen.push({ event: 'join:task', ctx: await ctxNow() });
          return { id: 't1' };
        }),
      },
    },
  };
});
vi.mock('../services/chat-service.js', () => {
  return {
    getSession: vi.fn(async () => {
      h.seen.push({ event: 'join:session', ctx: await ctxNow() });
      return { id: 's1' };
    }),
  };
});

import { setupSocketManager } from './socket-manager.js';
import { getTenant } from '../lib/tenant-context.js';

type Listener = (...args: unknown[]) => unknown;

function fakeServer() {
  let middleware: ((socket: unknown, next: (err?: Error) => void) => Promise<void>) | undefined;
  let onConnection: ((socket: unknown) => void) | undefined;
  const io = {
    engine: { use: vi.fn() },
    use: (fn: typeof middleware) => {
      middleware = fn;
    },
    on: (_e: string, fn: typeof onConnection) => {
      onConnection = fn;
    },
    to: () => ({ emit: vi.fn() }),
  };
  setupSocketManager(
    io as never,
    ((_req: unknown, _res: unknown, next: () => void) => next()) as never,
  );

  async function connect(userId: string | undefined) {
    const handlers = new Map<string, Listener>();
    const socket = {
      id: 'sock-1',
      request: { session: { userId } },
      rooms: new Set<string>(),
      emitted: [] as unknown[],
      on: (event: string, fn: Listener) => handlers.set(event, fn),
      emit(...args: unknown[]) {
        this.emitted.push(args);
      },
      join(room: string) {
        this.rooms.add(room);
      },
      leave(room: string) {
        this.rooms.delete(room);
      },
      to: () => ({ emit: vi.fn() }),
    };
    let err: Error | undefined;
    await middleware!(socket, (e?: Error) => {
      err = e;
    });
    if (!err) onConnection!(socket);
    return { socket, handlers, err };
  }
  return { connect };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('socket handlers run in the socket user’s tenant context', () => {
  beforeEach(() => {
    h.seen = [];
    h.user = { name: 'Member', team: { orgId: 'org-a' } };
  });

  it('rejects an unauthenticated handshake', async () => {
    const { err } = await fakeServer().connect(undefined);
    expect(err?.message).toBe('Unauthorized');
  });

  it.each(['join:session', 'join:task', 'join:org'])(
    '%s queries with { orgId, userId } of the socket user (no bypass)',
    async (event) => {
      const { socket, handlers } = await fakeServer().connect('u1');
      handlers.get(event)!(event === 'join:org' ? 'org-a' : 'id-1');
      await flush();
      expect(h.seen).toEqual([{ event, ctx: { orgId: 'org-a', userId: 'u1' } }]);
      expect(getTenant()).toBeNull();
      expect([...socket.rooms].some((r) => r.startsWith(event.split(':')[1]))).toBe(true);
    },
  );

  it('a user with no team gets a context with a null org (no GUC, like HTTP)', async () => {
    h.user = { name: 'Loner', team: null };
    const { handlers } = await fakeServer().connect('u2');
    handlers.get('join:task')!('id-1');
    await flush();
    expect(h.seen[0].ctx).toEqual({ orgId: null, userId: 'u2' });
  });

  it('listeners return synchronously and leave no context behind', async () => {
    const { handlers } = await fakeServer().connect('u1');
    expect(handlers.get('chat:stop')!(null)).toBeUndefined();
    await flush();
    expect(getTenant()).toBeNull();
  });
});

// ── Guard: no socket handler is registered outside onScoped ───────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

describe('every Socket.io event handler is registered through onScoped', () => {
  const srcDir = fileURLToPath(new URL('..', import.meta.url));
  const files = walk(srcDir).filter((f) => /\bsocket\.on\(/.test(readFileSync(f, 'utf8')));

  it('only socket-manager.ts registers socket handlers', () => {
    expect(files.map((f) => relative(srcDir, f))).toEqual([join('ws', 'socket-manager.ts')]);
  });

  it('the only raw socket.on( call is inside onScoped itself', () => {
    const src = readFileSync(join(srcDir, 'ws', 'socket-manager.ts'), 'utf8');
    const raw = src.match(/\bsocket\.on\(/g) ?? [];
    expect(raw).toHaveLength(1);
    const def = src.slice(src.indexOf('function onScoped'));
    expect(def.indexOf('socket.on(')).toBeLessThan(def.indexOf('\n}\n'));
    expect((src.match(/onScoped\(socket, '/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });
});
