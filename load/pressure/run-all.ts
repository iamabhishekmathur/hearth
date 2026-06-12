/**
 * Pressure-suite runner.
 *
 * Discovers every load/pressure/*.sim.ts and runs them SEQUENTIALLY (never in
 * parallel — the sims drive the real Claude agent worker and running them
 * concurrently would swamp it and produce flaky timeouts). For each sim it
 * prints a PASS/FAIL banner derived from:
 *   - the sim's process exit code (non-zero => FAIL), and
 *   - any "N fail" tally the sim prints in its own RESULTS line.
 * A final rollup summarises pass/fail counts and exits non-zero if any failed.
 *
 * Usage:
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/run-all.ts
 *   # or, from repo root, via pnpm:
 *   API_URL=http://localhost:8000/api/v1 pnpm pressure
 *
 * Flags / env:
 *   --list              Only discover and list the sims, do not run them.
 *   PRESSURE_ONLY=a,b   Run only sims whose basename contains one of these
 *                       comma-separated substrings (e.g. PRESSURE_ONLY=tasks).
 *   PRESSURE_TIMEOUT_MS Per-sim wall-clock timeout (default 600000 = 10 min).
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESSURE_DIR = __dirname;
const REPO_ROOT = resolve(__dirname, '..', '..');
// Use the api workspace's tsx so the sims resolve @prisma/client etc.
const TSX_BIN = join(REPO_ROOT, 'apps', 'api', 'node_modules', '.bin', 'tsx');
const API_URL = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PER_SIM_TIMEOUT_MS = Number(process.env.PRESSURE_TIMEOUT_MS ?? 600_000);

const LIST_ONLY = process.argv.includes('--list');
const ONLY = (process.env.PRESSURE_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function discoverSims(): string[] {
  return readdirSync(PRESSURE_DIR)
    .filter((f) => f.endsWith('.sim.ts'))
    .filter((f) => (ONLY.length ? ONLY.some((sub) => f.includes(sub)) : true))
    .sort();
}

interface SimResult {
  file: string;
  code: number | null;
  durationMs: number;
  reportedFail: number | null; // parsed "N fail" if the sim printed one
  status: 'PASS' | 'FAIL';
}

const RESULT_RE = /RESULTS?:?\s*(\d+)\s+pass[,\s]+(\d+)\s+fail/i;

function runSim(file: string): Promise<SimResult> {
  const abs = join(PRESSURE_DIR, file);
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(TSX_BIN, [abs], {
      cwd: REPO_ROOT,
      env: { ...process.env, API_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let reportedFail: number | null = null;
    let timedOut = false;

    const onChunk = (buf: Buffer, sink: NodeJS.WriteStream) => {
      const text = buf.toString();
      sink.write(text);
      const m = text.match(RESULT_RE);
      if (m) reportedFail = Number(m[2]);
    };
    child.stdout.on('data', (b) => onChunk(b, process.stdout));
    child.stderr.on('data', (b) => onChunk(b, process.stderr));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, PER_SIM_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      const failedByCode = timedOut || code !== 0;
      const failedByReport = reportedFail !== null && reportedFail > 0;
      resolvePromise({
        file,
        code: timedOut ? null : code,
        durationMs,
        reportedFail,
        status: failedByCode || failedByReport ? 'FAIL' : 'PASS',
      });
    });
  });
}

function banner(text: string) {
  const line = '═'.repeat(Math.max(text.length + 4, 60));
  console.log(`\n${line}\n  ${text}\n${line}`);
}

async function main() {
  const sims = discoverSims();
  banner(`Pressure suite — ${sims.length} sim(s) against ${API_URL}`);
  for (const s of sims) console.log(`  • ${s}`);

  if (LIST_ONLY) {
    console.log('\n(--list) discovery only; not running.');
    return;
  }
  if (sims.length === 0) {
    console.error('\nNo *.sim.ts files matched. Check load/pressure/ and PRESSURE_ONLY.');
    process.exit(1);
  }

  const results: SimResult[] = [];
  for (const file of sims) {
    banner(`▶ RUN  ${file}`);
    const r = await runSim(file);
    results.push(r);
    const secs = (r.durationMs / 1000).toFixed(1);
    const detail =
      r.reportedFail !== null
        ? `exit=${r.code} reported_fail=${r.reportedFail}`
        : `exit=${r.code}`;
    banner(`${r.status === 'PASS' ? 'PASS' : 'FAIL'}  ${file}  (${secs}s, ${detail})`);
  }

  banner('ROLLUP');
  const passed = results.filter((r) => r.status === 'PASS');
  const failed = results.filter((r) => r.status === 'FAIL');
  for (const r of results) {
    const secs = (r.durationMs / 1000).toFixed(1);
    console.log(
      `  [${r.status}] ${r.file.padEnd(28)} ${secs.padStart(6)}s  exit=${r.code}` +
        (r.reportedFail !== null ? `  reported_fail=${r.reportedFail}` : ''),
    );
  }
  console.log(`\n  ${passed.length} passed, ${failed.length} failed, of ${results.length} total.`);

  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('run-all fatal:', e);
  process.exit(1);
});
