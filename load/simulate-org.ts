/**
 * Hearth org-scale load simulator (Part 1 Tier E / Part 2 §2.26 INT-04).
 *
 * Spins up N virtual users against a RUNNING Hearth API and drives a mixed
 * read/write behavior loop (sessions, tasks, memory, activity, reactions),
 * then prints per-endpoint latency percentiles and error counts.
 *
 * Usage:
 *   API_URL=http://localhost:8000/api/v1 LOAD_USERS=36 tsx load/simulate-org.ts
 *
 * (tsx is a devDependency of @hearth/api, so from the repo root without a
 * global tsx use: ./apps/api/node_modules/.bin/tsx load/simulate-org.ts)
 *
 * Optional env:
 *   LOAD_DURATION_S  — behavior-loop duration in seconds (default 60)
 *   LOAD_THINK_MS    — base think time between iterations (default 400, jittered)
 *
 * Prerequisites:
 *   1. A running API (default http://localhost:8000/api/v1 — `pnpm dev`).
 *   2. Sim-seed data: `pnpm --filter @hearth/api sim-seed` — this creates the
 *      hearth-sim org with users like sim_member_0@hearth-sim.local (password
 *      'changeme') that the virtual users log in as.
 *
 * Notes:
 *   - HTTP uses Node's built-in global fetch only (no extra dependencies).
 *   - WebSocket/presence load is attempted via a dynamic import of
 *     'socket.io-client'; if that package is not installed the simulator
 *     logs a one-line note and runs HTTP-only. It is NEVER auto-installed.
 *   - A failed/errored request is counted in the metrics, never fatal.
 *   - CSRF: the API uses double-submit cookies — after login we read the
 *     hearth.csrf cookie and echo it as the x-csrf-token header on mutations,
 *     and persist hearth.sid in a per-user cookie jar.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = (process.env.API_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, '');
const LOAD_USERS = parseInt(process.env.LOAD_USERS ?? '36', 10);
const LOAD_DURATION_S = parseInt(process.env.LOAD_DURATION_S ?? '60', 10);
const LOAD_THINK_MS = parseInt(process.env.LOAD_THINK_MS ?? '400', 10);
const ORIGIN = new URL(API_URL).origin;

const PASSWORD = 'changeme';
const REACTION_EMOJIS = ['fire', 'thumbsup', 'heart', 'eyes', 'rocket'];

/** Sim-seed roster (apps/api/prisma/sim-seed.ts): 2 admin, 6 team_lead, 28 member, 4 viewer. */
function buildRoster(): string[] {
  const emails: string[] = [];
  const plan: Array<[string, number]> = [
    ['member', 28],
    ['team_lead', 6],
    ['admin', 2],
    ['viewer', 4],
  ];
  for (const [role, count] of plan) {
    for (let i = 0; i < count; i++) emails.push(`sim_${role}_${i}@hearth-sim.local`);
  }
  return emails;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

interface EndpointStats {
  latencies: number[];
  statuses: Map<number, number>;
  networkErrors: number;
}

const stats = new Map<string, EndpointStats>();
let totalRequests = 0;

function record(label: string, ms: number, status: number | null): void {
  let s = stats.get(label);
  if (!s) {
    s = { latencies: [], statuses: new Map(), networkErrors: 0 };
    stats.set(label, s);
  }
  totalRequests++;
  s.latencies.push(ms);
  if (status === null) s.networkErrors++;
  else s.statuses.set(status, (s.statuses.get(status) ?? 0) + 1);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// ─── Virtual user ────────────────────────────────────────────────────────────

interface VirtualUser {
  email: string;
  /** Manual cookie jar: name → value, persisted across all requests. */
  cookies: Map<string, string>;
  csrf: string | null;
  sessionId: string | null;
  socket: { disconnect: () => void } | null;
  heartbeat: ReturnType<typeof setInterval> | null;
}

function absorbSetCookies(vu: VirtualUser, res: Response): void {
  const setCookies: string[] =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie')?.split(/,(?=\s*\w+=)/) ?? []);
  for (const raw of setCookies) {
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    vu.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const csrf = vu.cookies.get('hearth.csrf');
  if (csrf) vu.csrf = decodeURIComponent(csrf);
}

function cookieHeader(vu: VirtualUser): string {
  return Array.from(vu.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Issue one HTTP request as a virtual user. Records latency + status under
 * `label`; never throws — network errors are counted and `null` is returned.
 */
async function request(
  vu: VirtualUser,
  method: string,
  path: string,
  label: string,
  body?: unknown,
): Promise<{ status: number; json: unknown } | null> {
  const headers: Record<string, string> = { cookie: cookieHeader(vu) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (vu.csrf && !['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = vu.csrf;

  const start = performance.now();
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    absorbSetCookies(vu, res);
    const json = await res.json().catch(() => null);
    record(label, performance.now() - start, res.status);
    return { status: res.status, json };
  } catch {
    record(label, performance.now() - start, null);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Optional socket.io presence load ────────────────────────────────────────

// Resolved lazily so the simulator works without the package installed.
// The Function-wrapped import avoids a compile-time module-resolution error.
type IoFactory = (url: string, opts: Record<string, unknown>) => {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  disconnect: () => void;
};

let ioFactory: IoFactory | null = null;
let socketsConnected = 0;
let socketErrors = 0;

async function loadSocketClient(): Promise<void> {
  try {
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<Record<string, unknown>>;
    const mod = await dynamicImport('socket.io-client');
    const candidate = (mod.io ?? (mod.default as Record<string, unknown> | undefined)?.io ?? mod.default) as
      | IoFactory
      | undefined;
    if (typeof candidate === 'function') ioFactory = candidate;
  } catch {
    ioFactory = null;
  }
  if (!ioFactory) {
    console.log('socket.io-client not available — HTTP-only load');
  }
}

/** Light presence loop: connect to /ws with the session cookie, join a room, heartbeat. */
function attachSocket(vu: VirtualUser): void {
  if (!ioFactory || !vu.sessionId) return;
  try {
    const socket = ioFactory(ORIGIN, {
      path: '/ws',
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { cookie: cookieHeader(vu) },
    });
    vu.socket = socket;
    socket.on('connect', () => {
      socketsConnected++;
      socket.emit('join:session', vu.sessionId);
      vu.heartbeat = setInterval(() => socket.emit('presence:heartbeat', vu.sessionId), 10_000);
    });
    socket.on('connect_error', () => {
      socketErrors++;
    });
    socket.on('error', () => {
      socketErrors++;
    });
  } catch {
    socketErrors++;
  }
}

function detachSocket(vu: VirtualUser): void {
  if (vu.heartbeat) clearInterval(vu.heartbeat);
  try {
    vu.socket?.disconnect();
  } catch {
    /* ignore */
  }
}

// ─── Behavior loop ───────────────────────────────────────────────────────────

async function login(vu: VirtualUser): Promise<boolean> {
  const res = await request(vu, 'POST', '/auth/login', 'POST /auth/login', {
    email: vu.email,
    password: PASSWORD,
  });
  return res?.status === 200 && !!vu.csrf;
}

async function behaviorIteration(vu: VirtualUser): Promise<void> {
  // 1. List chat sessions (remember one for socket presence)
  const sessions = await request(vu, 'GET', '/chat/sessions', 'GET /chat/sessions');
  if (sessions?.status === 200) {
    const data = (sessions.json as { data?: Array<{ id: string }> })?.data;
    if (!vu.sessionId && data && data.length > 0) vu.sessionId = data[0].id;
  }

  // 2. List tasks
  await request(vu, 'GET', '/tasks?parentOnly=true', 'GET /tasks');

  // 3. Create a memory entry, then read it back
  const mem = await request(vu, 'POST', '/memory', 'POST /memory', {
    layer: 'user',
    content: `Load-sim note from ${vu.email} at ${new Date().toISOString()}: prefers ${pick(['tabs', 'spaces', 'dark mode', 'morning standups'])}.`,
    source: 'load-sim',
  });
  if (mem?.status === 201) {
    const id = (mem.json as { data?: { id?: string } })?.data?.id;
    if (id) await request(vu, 'GET', `/memory/${id}`, 'GET /memory/:id');
  }

  // 4. List activity feed, then react to a random event
  const feed = await request(vu, 'GET', '/activity?limit=20', 'GET /activity');
  if (feed?.status === 200) {
    const events = (feed.json as { data?: Array<{ id: string }> })?.data;
    if (events && events.length > 0) {
      await request(
        vu,
        'POST',
        `/activity/${pick(events).id}/reactions`,
        'POST /activity/:id/reactions',
        { emoji: pick(REACTION_EMOJIS) },
      );
    }
  }
}

async function runVirtualUser(email: string, startDelayMs: number, deadline: number): Promise<void> {
  const vu: VirtualUser = {
    email,
    cookies: new Map(),
    csrf: null,
    sessionId: null,
    socket: null,
    heartbeat: null,
  };
  await sleep(startDelayMs);

  if (!(await login(vu))) {
    console.error(`  login failed for ${email} — skipping this virtual user`);
    return;
  }

  let socketAttached = false;
  while (Date.now() < deadline) {
    try {
      await behaviorIteration(vu);
    } catch {
      // Belt-and-braces: behavior errors are never fatal to the VU.
    }
    if (!socketAttached && vu.sessionId) {
      attachSocket(vu);
      socketAttached = true;
    }
    await sleep(LOAD_THINK_MS / 2 + Math.random() * LOAD_THINK_MS);
  }
  detachSocket(vu);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function printSummary(elapsedMs: number): void {
  const labels = Array.from(stats.keys()).sort();
  const headers = ['endpoint', 'reqs', 'ok', 'err', 'p50ms', 'p95ms', 'p99ms', 'max ms'];
  const rows: string[][] = [];
  let totalErrors = 0;

  for (const label of labels) {
    const s = stats.get(label)!;
    const sorted = [...s.latencies].sort((a, b) => a - b);
    let ok = 0;
    let err = s.networkErrors;
    for (const [status, count] of s.statuses) {
      if (status < 400) ok += count;
      else err += count;
    }
    totalErrors += err;
    rows.push([
      label,
      String(s.latencies.length),
      String(ok),
      String(err),
      percentile(sorted, 50).toFixed(1),
      percentile(sorted, 95).toFixed(1),
      percentile(sorted, 99).toFixed(1),
      (sorted[sorted.length - 1] ?? 0).toFixed(1),
    ]);
  }

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]) =>
    r.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ');

  console.log('\n── Load summary ' + '─'.repeat(60));
  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(fmt(row));

  console.log('\nErrors by status:');
  let anyError = false;
  for (const label of labels) {
    const s = stats.get(label)!;
    const parts: string[] = [];
    for (const [status, count] of [...s.statuses.entries()].sort((a, b) => a[0] - b[0])) {
      if (status >= 400) parts.push(`${status}×${count}`);
    }
    if (s.networkErrors > 0) parts.push(`network×${s.networkErrors}`);
    if (parts.length > 0) {
      anyError = true;
      console.log(`  ${label}: ${parts.join(', ')}`);
    }
  }
  if (!anyError) console.log('  (none)');

  const seconds = elapsedMs / 1000;
  console.log(`\nTotal requests: ${totalRequests}  errors: ${totalErrors}`);
  console.log(`Wall time: ${seconds.toFixed(1)}s  throughput: ${(totalRequests / seconds).toFixed(1)} req/s`);
  if (ioFactory) {
    console.log(`Sockets: ${socketsConnected} connected, ${socketErrors} errors`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `Hearth load simulator — ${LOAD_USERS} virtual users vs ${API_URL} for ${LOAD_DURATION_S}s`,
  );
  await loadSocketClient();

  const roster = buildRoster();
  const startedAt = Date.now();
  const deadline = startedAt + LOAD_DURATION_S * 1000;

  let finished = false;
  process.on('SIGINT', () => {
    if (finished) return;
    finished = true;
    console.log('\nInterrupted — printing partial summary.');
    printSummary(Date.now() - startedAt);
    process.exit(130);
  });

  const users = Array.from({ length: LOAD_USERS }, (_, i) => roster[i % roster.length]);
  await Promise.all(users.map((email, i) => runVirtualUser(email, i * 50, deadline)));

  finished = true;
  printSummary(Date.now() - startedAt);
}

main().catch((err) => {
  console.error('load simulator failed:', err);
  process.exit(1);
});
