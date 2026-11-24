import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withJobContext } from './job-context.js';
import { getTenant, runWithTenant, runAsSystem } from './tenant-context.js';

describe('runAsSystem', () => {
  it('runs fn in a bypass context with no org or user', async () => {
    const seen = await runAsSystem(async () => getTenant());
    expect(seen).toEqual({ orgId: null, userId: null, bypass: true });
  });

  it('does not leak the context after fn resolves', async () => {
    await runAsSystem(async () => undefined);
    expect(getTenant()).toBeNull();
  });
});

describe('withJobContext', () => {
  it('runs the processor in the system (bypass) context', async () => {
    const processor = withJobContext(async () => getTenant());
    expect(getTenant()).toBeNull();
    expect(await processor()).toEqual({ orgId: null, userId: null, bypass: true });
  });

  it('passes every processor argument through unchanged', async () => {
    const job = { id: 'j1', name: 'n', data: { routineId: 'r1' } };
    const signal = new AbortController().signal;
    const processor = withJobContext(async (j: typeof job, token?: string, s?: AbortSignal) => ({
      j,
      token,
      s,
    }));
    const out = await processor(job, 'tok', signal);
    expect(out.j).toBe(job);
    expect(out.token).toBe('tok');
    expect(out.s).toBe(signal);
  });

  it('returns the processor result and propagates its errors', async () => {
    expect(await withJobContext(async () => 42)()).toBe(42);
    const boom = withJobContext(async () => {
      throw new Error('job failed');
    });
    await expect(boom()).rejects.toThrow('job failed');
  });

  it('keeps the context across awaits inside the processor', async () => {
    const processor = withJobContext(async () => {
      await new Promise((r) => setTimeout(r, 5));
      await Promise.resolve();
      return getTenant()?.bypass;
    });
    expect(await processor()).toBe(true);
  });

  it('replaces any outer context (a job never runs as the enqueuing org)', async () => {
    const processor = withJobContext(async () => getTenant());
    const seen = await runWithTenant({ orgId: 'org-a', userId: 'u1', inExplicitTx: true }, () =>
      processor(),
    );
    expect(seen).toEqual({ orgId: null, userId: null, bypass: true });
  });

  it('isolates concurrent jobs from each other', async () => {
    const processor = withJobContext(async (ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
      return getTenant();
    });
    const results = await Promise.all([processor(10), processor(1), processor(5)]);
    for (const r of results) expect(r).toEqual({ orgId: null, userId: null, bypass: true });
  });
});

// ── Guard: every BullMQ worker processor in src/ is wrapped ───────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

describe('every new Worker(...) processor is wrapped in withJobContext', () => {
  const srcDir = fileURLToPath(new URL('..', import.meta.url));
  const files = walk(srcDir).filter((f) => /new Worker\s*[<(]/.test(readFileSync(f, 'utf8')));

  it('finds the known worker files', () => {
    // 16 queues are registered in worker.ts; each has one Worker.
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it.each(files.map((f) => [relative(srcDir, f), f]))('%s', (_rel, file) => {
    const src = readFileSync(file, 'utf8');
    const calls = src.split(/new Worker\s*(?:<[^>]*>)?\(/).slice(1);
    for (const call of calls) {
      // Second positional argument: skip the queue name (first comma).
      const afterName = call.slice(call.indexOf(',') + 1).trimStart();
      expect(afterName.startsWith('withJobContext(')).toBe(true);
    }
  });
});

describe('runWithTenant with a lazy thenable (Prisma query promises)', () => {
  it('executes the thenable inside the context', async () => {
    let seen: unknown = 'not run';
    // Mimics a PrismaPromise: nothing runs until .then is called.
    const lazy = {
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        try {
          seen = getTenant();
          resolve('ok');
        } catch (e) {
          reject(e);
        }
      },
    } as unknown as Promise<string>;
    expect(await runAsSystem(() => lazy)).toBe('ok');
    expect(seen).toEqual({ orgId: null, userId: null, bypass: true });
  });
});
