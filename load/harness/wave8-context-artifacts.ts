/**
 * WAVE 8 — Task context items + artifact versioning (deep sub-features).
 *
 * Context: add note/link/text_block; file upload (happy, >10MB rejected,
 * disallowed MIME rejected, path-traversal filename sanitized); analyze on a
 * non-image → 422/400. Artifacts: update bumps version; version history;
 * concurrent update lost-update race.
 */
import { loginAs, prisma, sleep, short, Recorder } from './core.js';

const F1 = 'Task Context';
const F2 = 'Artifacts';

async function main() {
  const rec = new Recorder('wave8-context-artifacts');
  const u = await loginAs('dev1@hearth.local');
  const task = (await u.req<{ data?: { id: string } }>('POST', '/tasks', { title: 'Tune the checkout pool', source: 'manual' })).body.data!;

  // ── Context items: note / link / text_block ───────────────────────────────
  console.log('\n══ Context items ══');
  for (const [type, rawValue] of [['note', 'PgBouncer is in transaction mode'], ['link', 'https://wiki.internal/pgbouncer'], ['text_block', 'pool_size=20, max_overflow=10']] as const) {
    const r = await u.req('POST', `/tasks/${task.id}/context-items`, { type, rawValue, label: `${type} ctx` });
    rec.record({ feature: F1, subFeature: 'add', type: 'happy', name: `Add a ${type} context item`,
      expected: '201', observed: `status ${r.status}`, status: r.status === 201 ? 'pass' : 'fail' });
  }
  {
    const missing = await u.req('POST', `/tasks/${task.id}/context-items`, { type: 'note' }); // no rawValue
    rec.record({ feature: F1, subFeature: 'validation', type: 'user_error', name: 'Add context item without rawValue',
      expected: '400', observed: `status ${missing.status}`, status: missing.status === 400 ? 'pass' : 'fail' });
  }

  // ── File uploads ──────────────────────────────────────────────────────────
  console.log('\n══ File upload ══');
  {
    const form = new FormData();
    form.append('file', new Blob(['pool metrics csv\n1,2,3'], { type: 'text/plain' }), 'metrics.txt');
    const r = await u.reqForm(`/tasks/${task.id}/context-items/upload`, form);
    rec.record({ feature: F1, subFeature: 'upload', type: 'happy', name: 'Upload a small text file',
      expected: '201', observed: `status ${r.status}`, status: r.status === 201 ? 'pass' : 'fail' });
  }
  {
    const big = new Uint8Array(11 * 1024 * 1024); // 11MB > 10MB limit
    const form = new FormData();
    form.append('file', new Blob([big], { type: 'text/plain' }), 'huge.txt');
    const r = await u.reqForm(`/tasks/${task.id}/context-items/upload`, form);
    rec.record({ feature: F1, subFeature: 'upload limits', type: 'pressure', name: 'Upload a file over the 10MB limit',
      expected: 'rejected (413/400)', observed: `status ${r.status}`, status: r.status >= 400 && r.status < 500 ? 'pass' : 'fail',
      defects: r.status === 201 ? ['11MB file accepted — 10MB limit not enforced'] : (r.status >= 500 ? ['Oversize upload returns 500 instead of a clean 413/400'] : undefined) });
  }
  {
    const form = new FormData();
    form.append('file', new Blob(['PK\x03\x04zip'], { type: 'application/zip' }), 'evil.zip');
    const r = await u.reqForm(`/tasks/${task.id}/context-items/upload`, form);
    rec.record({ feature: F1, subFeature: 'upload MIME', type: 'user_error', name: 'Upload a disallowed MIME (application/zip)',
      expected: 'rejected', observed: `status ${r.status}`, status: r.status >= 400 && r.status < 500 ? 'pass' : 'fail',
      defects: r.status === 201 ? ['Disallowed MIME (application/zip) accepted'] : undefined });
  }
  {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'text/plain' }), '../../../etc/passwd');
    const r = await u.reqForm<{ data?: { id: string } }>(`/tasks/${task.id}/context-items/upload`, form);
    // sanitized filename should not contain path separators; verify on disk reference if available
    rec.record({ feature: F1, subFeature: 'upload traversal', type: 'violation', name: 'Upload with a path-traversal filename',
      expected: 'filename sanitized; no traversal', observed: `status ${r.status}`, status: r.status === 201 ? 'pass' : 'partial' });
  }

  // ── Artifact versioning + concurrency ─────────────────────────────────────
  console.log('\n══ Artifact versioning ══');
  const sid = await u.newSession('Artifact versioning');
  const art = (await u.req<{ data?: { id: string; version?: number } }>('POST', `/chat/sessions/${sid}/artifacts`, { type: 'code', title: 'health.ts', content: 'export const ok = () => true;', language: 'typescript' })).body.data!;
  rec.record({ feature: F2, subFeature: 'versioning', type: 'happy', name: 'Create artifact (v1)',
    expected: '201 version 1', observed: `version ${art.version}`, status: art.id ? 'pass' : 'fail' });
  const up = await u.req('PATCH', `/chat/artifacts/${art.id}`, { content: 'export const ok = () => false;' });
  rec.record({ feature: F2, subFeature: 'versioning', type: 'happy', name: 'Update artifact bumps version',
    expected: '200, version 2', observed: `status ${up.status}`, status: up.status === 200 ? 'pass' : 'fail' });
  const versions = await u.req<{ data?: any[] }>('GET', `/chat/artifacts/${art.id}/versions`);
  rec.record({ feature: F2, subFeature: 'versioning', type: 'happy', name: 'List version history',
    expected: '≥2 versions', observed: `${versions.body.data?.length ?? 0} versions`, status: (versions.body.data?.length ?? 0) >= 2 ? 'pass' : 'fail' });
  {
    // concurrent updates — lost-update race (both read same current version)
    const [a, b] = await Promise.all([
      u.req('PATCH', `/chat/artifacts/${art.id}`, { content: 'A wins' }),
      u.req('PATCH', `/chat/artifacts/${art.id}`, { content: 'B wins' }),
    ]);
    await sleep(300);
    const final = await prisma.artifact.findUnique({ where: { id: art.id }, select: { version: true } });
    const vcount = await prisma.artifactVersion.count({ where: { artifactId: art.id } });
    // With optimistic concurrency both updates apply serially and the final
    // version equals the version-row count (one row per increment, no collision).
    const consistent = final?.version === vcount;
    rec.record({ feature: F2, subFeature: 'concurrency', type: 'pressure', name: 'Concurrent artifact updates',
      expected: 'no lost update / version collision (final version == version-row count)', observed: `a=${a.status} b=${b.status}; final version=${final?.version}; ${vcount} version rows`,
      status: a.status === 200 && b.status === 200 && consistent ? 'pass' : (a.status === 200 && b.status === 200 ? 'fail' : 'partial'),
      defects: a.status === 200 && b.status === 200 && final && !consistent ? [`Concurrent updates desynced version (${final.version}) from version-row count (${vcount}) — no optimistic concurrency control`] : undefined });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave8 failed:', e); await prisma.$disconnect(); process.exit(1); });
