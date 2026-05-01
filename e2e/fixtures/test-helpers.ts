/**
 * Shared test helpers for comprehensive Hearth E2E tests.
 * Provides auth management, API helpers, and common utilities.
 */
import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ─── Constants ───────────────────────────────────────────────────────────────

export const API = 'http://localhost:8000/api/v1';
export const AUTH_DIR = path.join(__dirname, '..', '..', 'test-results', '.auth');

// ─── User Credentials ───────────────────────────────────────────────────────

export interface UserCredentials {
  email: string;
  password: string;
  name: string;
  role: string;
  team: string;
}

export const USERS: Record<string, UserCredentials> = {
  admin: { email: 'admin@hearth.local', password: 'changeme', name: 'Admin', role: 'admin', team: 'Engineering' },
  cto: { email: 'cto@hearth.local', password: 'changeme', name: 'CTO', role: 'admin', team: 'Engineering' },
  engLead: { email: 'eng-lead@hearth.local', password: 'changeme', name: 'Engineering Lead', role: 'team_lead', team: 'Engineering' },
  productLead: { email: 'product-lead@hearth.local', password: 'changeme', name: 'Product Lead', role: 'team_lead', team: 'Product' },
  dev1: { email: 'dev1@hearth.local', password: 'changeme', name: 'Developer One', role: 'member', team: 'Engineering' },
  dev2: { email: 'dev2@hearth.local', password: 'changeme', name: 'Developer Two', role: 'member', team: 'Engineering' },
  pm1: { email: 'pm1@hearth.local', password: 'changeme', name: 'Product Manager', role: 'member', team: 'Product' },
  designer: { email: 'designer@hearth.local', password: 'changeme', name: 'Designer', role: 'member', team: 'Design' },
  dataAnalyst: { email: 'data-analyst@hearth.local', password: 'changeme', name: 'Data Analyst', role: 'member', team: 'Engineering' },
  intern: { email: 'intern@hearth.local', password: 'changeme', name: 'Intern', role: 'viewer', team: 'Engineering' },
  contractor: { email: 'contractor@hearth.local', password: 'changeme', name: 'Contractor', role: 'viewer', team: 'Product' },
  newHire: { email: 'new-hire@hearth.local', password: 'changeme', name: 'New Hire', role: 'member', team: 'Engineering' },
};

// ─── Auth State Management ───────────────────────────────────────────────────

interface AuthState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  csrf: string;
}

function authFile(userKey: string): string {
  return path.join(AUTH_DIR, `${userKey}.json`);
}

export async function loginAs(
  page: Page,
  userKey: string,
): Promise<string> {
  const creds = USERS[userKey];
  if (!creds) throw new Error(`Unknown user: ${userKey}`);

  // Try cached auth
  const cached = authFile(userKey);
  if (fs.existsSync(cached)) {
    const state: AuthState = JSON.parse(fs.readFileSync(cached, 'utf-8'));
    await page.context().addCookies(state.cookies);
    const check = await page.request.get(`${API}/tasks?parentOnly=true`);
    if (check.ok()) return state.csrf;
  }

  // Login via API (more reliable than UI for multi-user tests)
  const loginRes = await page.request.post(`${API}/auth/login`, {
    data: { email: creds.email, password: creds.password },
  });

  if (loginRes.status() !== 200) {
    throw new Error(`Login API failed for ${creds.email} — status ${loginRes.status()}`);
  }

  // The API sets cookies (hearth.csrf + hearth.sid) via Set-Cookie headers.
  // Playwright's page.request auto-stores cookies from API responses.
  // We need to extract them and also make them available to the browser context.
  const cookies = await page.context().cookies();
  let csrf = cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';

  // If CSRF not in browser cookies yet (API-only login), parse from response headers
  if (!csrf) {
    const setCookie = loginRes.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
    for (const hdr of setCookie) {
      const csrfMatch = hdr.value.match(/hearth\.csrf=([^;]+)/);
      if (csrfMatch) csrf = csrfMatch[1];
    }

    // Inject cookies into browser context for page navigation
    if (csrf) {
      const sidMatch = setCookie.map(h => h.value).join('').match(/hearth\.sid=([^;]+)/);
      const cookiesToAdd = [
        { name: 'hearth.csrf', value: csrf, domain: 'localhost', path: '/', sameSite: 'Strict' as const, httpOnly: false, secure: false, expires: Date.now() / 1000 + 86400 * 30 },
      ];
      if (sidMatch) {
        cookiesToAdd.push({ name: 'hearth.sid', value: decodeURIComponent(sidMatch[1]), domain: 'localhost', path: '/', sameSite: 'Lax' as const, httpOnly: true, secure: false, expires: Date.now() / 1000 + 86400 * 30 });
      }
      await page.context().addCookies(cookiesToAdd);
    }
  }

  if (!csrf) {
    throw new Error(`Login failed for ${creds.email} — no CSRF cookie set`);
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(cached, JSON.stringify({ cookies, csrf }));
  return csrf;
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

export function apiHeaders(csrf: string) {
  return { 'x-csrf-token': csrf, 'Content-Type': 'application/json' };
}

export async function apiGet(page: Page, urlPath: string) {
  const res = await page.request.get(`${API}${urlPath}`);
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

export async function apiPost(page: Page, csrf: string, urlPath: string, data?: unknown) {
  const res = await page.request.post(`${API}${urlPath}`, {
    headers: apiHeaders(csrf),
    data,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

export async function apiPut(page: Page, csrf: string, urlPath: string, data?: unknown) {
  const res = await page.request.put(`${API}${urlPath}`, {
    headers: apiHeaders(csrf),
    data,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

export async function apiPatch(page: Page, csrf: string, urlPath: string, data?: unknown) {
  const res = await page.request.patch(`${API}${urlPath}`, {
    headers: apiHeaders(csrf),
    data,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

export async function apiDelete(page: Page, csrf: string, urlPath: string) {
  const res = await page.request.delete(`${API}${urlPath}`, {
    headers: { 'x-csrf-token': csrf },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

// ─── Task Helpers ────────────────────────────────────────────────────────────

export async function createTask(
  page: Page,
  csrf: string,
  data: { title: string; description?: string; source?: string; priority?: number },
) {
  const res = await apiPost(page, csrf, '/tasks', { source: 'manual', ...data });
  expect(res.status).toBe(201);
  return res.body.data;
}

export async function deleteTask(page: Page, csrf: string, id: string) {
  await page.request.delete(`${API}/tasks/${id}`, { headers: { 'x-csrf-token': csrf } });
}

export async function pollTaskStatus(
  page: Page,
  taskId: string,
  targetStatuses: string[],
  maxWaitMs = 60_000,
) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await page.request.get(`${API}/tasks/${taskId}`);
    const body = await res.json();
    if (targetStatuses.includes(body.data?.status)) return body.data;
    await page.waitForTimeout(2000);
  }
  throw new Error(`Task ${taskId} did not reach ${targetStatuses.join('|')} within ${maxWaitMs}ms`);
}

// ─── Session Helpers ─────────────────────────────────────────────────────────

export async function createSession(page: Page, csrf: string, title?: string) {
  const res = await apiPost(page, csrf, '/chat/sessions', { title: title ?? `Test ${Date.now()}` });
  expect(res.status).toBe(201);
  return res.body.data;
}

export async function deleteSession(page: Page, csrf: string, id: string) {
  await page.request.delete(`${API}/chat/sessions/${id}`, { headers: { 'x-csrf-token': csrf } });
}

export async function sendMessage(page: Page, csrf: string, sessionId: string, content: string) {
  return apiPost(page, csrf, `/chat/sessions/${sessionId}/messages`, { content });
}

// ─── Decision Helpers ────────────────────────────────────────────────────────

export async function createDecision(
  page: Page,
  csrf: string,
  data: {
    title: string;
    reasoning: string;
    domain?: string;
    alternatives?: string[];
    scope?: string;
    confidence?: string;
    status?: string;
  },
) {
  const res = await apiPost(page, csrf, '/decisions', {
    domain: 'engineering',
    alternatives: [],
    scope: 'org',
    confidence: 'medium',
    ...data,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

// ─── Routine Helpers ─────────────────────────────────────────────────────────

export async function createRoutine(
  page: Page,
  csrf: string,
  data: {
    name: string;
    prompt: string;
    schedule?: string;
    delivery?: unknown;
    parameters?: unknown;
    scope?: string;
  },
) {
  const res = await apiPost(page, csrf, '/routines', {
    delivery: { channels: ['in_app'] },
    ...data,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

export async function pollRunStatus(
  page: Page,
  routineId: string,
  maxWaitMs = 60_000,
) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { body } = await apiGet(page, `/routines/${routineId}/runs`);
    if (body.data?.length > 0) {
      const latest = body.data[0];
      if (latest.status === 'success' || latest.status === 'failed') return latest;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`Routine ${routineId} run did not complete within ${maxWaitMs}ms`);
}

// ─── Memory Helpers ──────────────────────────────────────────────────────────

export async function createMemory(
  page: Page,
  csrf: string,
  data: { content: string; layer: string; source?: string },
) {
  const res = await apiPost(page, csrf, '/memory', data);
  expect(res.status).toBe(201);
  return res.body.data;
}

// ─── Skill Helpers ───────────────────────────────────────────────────────────

export async function createSkill(
  page: Page,
  csrf: string,
  data: {
    name: string;
    description?: string;
    content: string;
    scope?: string;
  },
) {
  const res = await apiPost(page, csrf, '/skills', {
    scope: 'personal',
    description: 'Test skill',
    ...data,
  });
  return { status: res.status, data: res.body.data };
}

// ─── Cleanup Tracker ─────────────────────────────────────────────────────────

export class Cleanup {
  private actions: Array<() => Promise<void>> = [];

  add(fn: () => Promise<void>) {
    this.actions.push(fn);
  }

  async run() {
    for (const action of this.actions.reverse()) {
      try {
        await action();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.actions = [];
  }
}

// ─── Wait utilities ──────────────────────────────────────────────────────────

export async function waitForEmbedding(page: Page, entityPath: string, maxWaitMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { body } = await apiGet(page, entityPath);
    if (body.data?.embedding !== null && body.data?.embedding !== undefined) return body.data;
    await page.waitForTimeout(1000);
  }
  return null; // Embedding may not be generated if no LLM provider
}

// ─── Multi-User Context ──────────────────────────────────────────────────────

import type { Browser } from '@playwright/test';

/**
 * Login as a different user in an isolated browser context.
 * Use this for multi-user tests where you need two users simultaneously.
 * Returns { page, csrf, cleanup } — call cleanup() when done.
 */
export async function loginAsNewContext(
  browser: Browser,
  userKey: string,
): Promise<{ page: Page; csrf: string; cleanup: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const csrf = await loginAs(page, userKey);
  return {
    page,
    csrf,
    cleanup: async () => {
      await page.close();
      await context.close();
    },
  };
}

// ─── LLM Availability ───────────────────────────────────────────────────────

/** True if an LLM API key is configured (tests that need agent execution should check this) */
export const HAS_LLM = !!(
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.LLM_API_KEY
);

// ─── Unique ID generation ────────────────────────────────────────────────────

let counter = 0;
export function uniqueId(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${++counter}`;
}
