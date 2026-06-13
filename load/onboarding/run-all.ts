/**
 * Onboarding-suite runner.
 *
 * Drives a brand-new company through Hearth's first-run path against an
 * ISOLATED fresh instance (default :8100 — NOT the dev :8000 instance; see
 * README.md). Runs the onboarding sims SEQUENTIALLY in a DELIBERATE ORDER
 * (never in parallel — the sims drive the real Claude agent + workers, and
 * they share one bootstrap org, so order matters):
 *
 *   1. genesis.sim.ts            — blank slate → create org + first admin →
 *                                  cold-start cliff (chat before LLM) →
 *                                  configure LLM via the real wizard.
 *                                  MUST run first: it leaves behind the org +
 *                                  a working Anthropic key the rest depend on.
 *   2. activation-triggers.sim.ts — fresh member; decision/memory/task born
 *                                  through their REAL indirect triggers
 *                                  (capture_decision / save_memory / create_task).
 *   3. teammates-join.sim.ts     — self-register teammates, promotion path,
 *                                  invite-flow / email-verification probes.
 *   4. integration-deadzone.sim.ts — connect a first integration, prove the
 *                                  no-immediate-value dead-zone.
 *   5. coldstart.sim.ts          — cold-start personalization: cognitive
 *                                  profile gate + proactive-surface empties.
 *
 * For each sim it prints a PASS/FAIL banner derived from:
 *   - the sim's process exit code (non-zero => FAIL), and
 *   - any "N fail" tally the sim prints in its own RESULTS line.
 * A final rollup summarises pass/fail counts and exits non-zero if any
 * sim hard-failed (a non-zero exit). NOTE: several onboarding sims are
 * VERDICT sims — they intentionally record `status:"fail"` results for
 * negative findings (e.g. "cognitive profile is gated off") without crashing,
 * so a clean run can still report reasoned `fail` verdicts while exiting 0.
 *
 * Usage:
 *   API_URL=http://localhost:8100/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/onboarding/run-all.ts
 *
 * Flags / env:
 *   --list                 Only discover/list the ordered sims, do not run.
 *   ONBOARDING_ONLY=a,b    Run only sims whose basename contains one of these
 *                          comma-separated substrings (e.g. ONBOARDING_ONLY=genesis).
 *   ONBOARDING_TIMEOUT_MS  Per-sim wall-clock timeout (default 600000 = 10 min).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ONBOARDING_DIR = __dirname;
const REPO_ROOT = resolve(__dirname, '..', '..');
// Use the api workspace's tsx so the sims resolve @prisma/client etc.
const TSX_BIN = join(REPO_ROOT, 'apps', 'api', 'node_modules', '.bin', 'tsx');
// Default to the ISOLATED onboarding instance, not the dev :8000.
const API_URL = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const PER_SIM_TIMEOUT_MS = Number(process.env.ONBOARDING_TIMEOUT_MS ?? 600_000);

const LIST_ONLY = process.argv.includes('--list');
const ONLY = (process.env.ONBOARDING_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// DELIBERATE order — genesis MUST run first (it creates the org + LLM key the
// rest of the journeys depend on). Do NOT sort alphabetically.
const ORDERED_SIMS = [
  'genesis.sim.ts',
  'activation-triggers.sim.ts',
  'teammates-join.sim.ts',
  'integration-deadzone.sim.ts',
  'coldstart.sim.ts',
];

function discoverSims(): string[] {
  return ORDERED_SIMS.filter((f) => existsSync(join(ONBOARDING_DIR, f))).filter((f) =>
    ONLY.length ? ONLY.some((sub) => f.includes(sub)) : true,
  );
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
  const abs = join(ONBOARDING_DIR, file);
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
      resolvePromise({
        file,
        code: timedOut ? null : code,
        durationMs,
        reportedFail,
        // Hard FAIL only on a non-zero/timeout exit. Reasoned negative
        // verdicts ("N fail" with exit 0) are surfaced but do NOT flip the
        // suite to FAIL — they are findings, not crashes.
        status: failedByCode ? 'FAIL' : 'PASS',
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
  banner(`Onboarding suite — ${sims.length} sim(s) against ${API_URL}`);
  for (const s of sims) console.log(`  • ${s}`);
  if (!process.env.API_URL) {
    console.log('\n  (API_URL not set; defaulting to the isolated onboarding instance :8100)');
  }

  if (LIST_ONLY) {
    console.log('\n(--list) discovery only; not running.');
    return;
  }
  if (sims.length === 0) {
    console.error('\nNo onboarding sims matched. Check load/onboarding/ and ONBOARDING_ONLY.');
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
      `  [${r.status}] ${r.file.padEnd(30)} ${secs.padStart(6)}s  exit=${r.code}` +
        (r.reportedFail !== null ? `  reported_fail=${r.reportedFail}` : ''),
    );
  }
  console.log(`\n  ${passed.length} passed, ${failed.length} failed, of ${results.length} total.`);
  console.log(
    '  (A "reported_fail" tally is a reasoned negative VERDICT, not a crash — see README.md.)',
  );

  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('run-all fatal:', e);
  process.exit(1);
});
