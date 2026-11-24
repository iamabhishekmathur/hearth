/**
 * Knowledge loop, Phase 1 gate — sample signals for a human to grade.
 *
 * The Phase 1 gate is "at least 35 of 50 sampled signals point to a real gap".
 * This prints a random sample of signals (already redacted at write time) as
 * CSV with an empty `real_gap` column to fill in with y/n.
 *
 *   pnpm --filter @hearth/api signals:sample -- --org <orgId> [--n 50] [--days 30]
 *
 * Read-only. Runs with the RLS bypass because it is an operator tool, and it
 * prints only one org's rows.
 */
import { withRlsBypass } from '../lib/tenant-context.js';
import { prisma } from '../lib/prisma.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function csv(v: unknown): string {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return `"${s.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const orgId = arg('org');
  if (!orgId) {
    console.error('Usage: signals:sample -- --org <orgId> [--n 50] [--days 30]');
    process.exit(1);
  }
  const n = Math.min(Math.max(parseInt(arg('n', '50')!, 10) || 50, 1), 500);
  const days = Math.max(parseInt(arg('days', '30')!, 10) || 30, 1);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await withRlsBypass((tx) =>
    tx.knowledgeSignal.findMany({
      where: { orgId, createdAt: { gte: since } },
      select: { id: true, kind: true, source: true, text: true, detail: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  );

  // Fisher–Yates on a copy, then take n.
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sample = pool.slice(0, n);

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.error(
    `# ${rows.length} signals in the last ${days} days; by kind: ${JSON.stringify(counts)}`,
  );
  console.error(`# sampling ${sample.length}. Fill real_gap with y/n. Gate: >= 70% y.`);

  console.log(['id', 'created_at', 'kind', 'source', 'text', 'detail', 'real_gap'].join(','));
  for (const r of sample) {
    console.log(
      [
        csv(r.id),
        csv(r.createdAt.toISOString()),
        csv(r.kind),
        csv(r.source),
        csv(r.text),
        csv(r.detail),
        '""',
      ].join(','),
    );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
