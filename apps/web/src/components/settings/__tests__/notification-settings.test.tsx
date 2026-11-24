import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

const apiGet = vi.hoisted(() => vi.fn());
const apiPut = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ api: { get: apiGet, put: apiPut, post: vi.fn() } }));

import { NotificationSettings } from '../notification-settings';
import { ActivityKnowledge, areaText, impactText } from '@/components/knowledge/activity-knowledge';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const prefs = (over: Record<string, boolean> = {}, knowledgeLoop = true) => ({
  data: {
    prefs: {
      knowledgeSummary: true,
      knowledgeEmail: false,
      adminWeeklySummary: true,
      knowledgeImpact: true,
      ...over,
    },
    knowledgeLoop,
  },
});

const switches = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="switch"]'));

describe('NotificationSettings', () => {
  it('renders nothing when the knowledge loop is off', async () => {
    apiGet.mockResolvedValue(prefs({}, false));
    act(() => root.render(<NotificationSettings isAdmin />));
    await flush();
    expect(container.innerHTML).toBe('');
  });

  it('shows the switches with their state; the weekly summary only for admins', async () => {
    apiGet.mockResolvedValue(prefs());
    act(() => root.render(<NotificationSettings isAdmin={false} />));
    await flush();
    const keys = switches().map((s) => s.dataset.pref);
    expect(keys).toEqual(['knowledgeSummary', 'knowledgeEmail', 'knowledgeImpact']);
    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'true',
    ]);
  });

  it('admins also see the weekly summary switch', async () => {
    apiGet.mockResolvedValue(prefs());
    act(() => root.render(<NotificationSettings isAdmin />));
    await flush();
    expect(switches().map((s) => s.dataset.pref)).toContain('adminWeeklySummary');
  });

  it('flipping a switch PUTs just that key and shows the saved state', async () => {
    apiGet.mockResolvedValue(prefs());
    apiPut.mockResolvedValue(prefs({ knowledgeEmail: true }));
    act(() => root.render(<NotificationSettings isAdmin={false} />));
    await flush();
    const email = switches().find((s) => s.dataset.pref === 'knowledgeEmail')!;
    await act(async () => email.click());
    await flush();
    expect(apiPut).toHaveBeenCalledWith('/notifications/preferences', { knowledgeEmail: true });
    expect(
      switches()
        .find((s) => s.dataset.pref === 'knowledgeEmail')!
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('a failed save rolls the switch back and says so', async () => {
    apiGet.mockResolvedValue(prefs());
    apiPut.mockRejectedValue(new Error('offline'));
    act(() => root.render(<NotificationSettings isAdmin={false} />));
    await flush();
    const summary = switches().find((s) => s.dataset.pref === 'knowledgeSummary')!;
    await act(async () => summary.click());
    await flush();
    expect(
      switches()
        .find((s) => s.dataset.pref === 'knowledgeSummary')!
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('ActivityKnowledge', () => {
  const summary = {
    days: 7,
    since: '',
    changed: { approved: 2, edited: 1, rejected: 0 },
    waiting: { pending: 3, oldestDays: 9 },
    unowned: [
      { reason: 'team_no_lead', teamId: 't', teamName: 'Ops', memory: 2, routines: 1, items: [] },
    ],
  };

  function route(map: Record<string, unknown>) {
    apiGet.mockImplementation(async (path: string) => {
      if (path in map) return map[path];
      throw Object.assign(new Error('nope'), { status: 404 });
    });
  }

  it('a member whose input helped sees one line; no admin card', async () => {
    route({
      '/notifications/preferences': prefs({ adminWeeklySummary: false }),
      '/knowledge/my-impact?days=7': { data: { count: 2, days: 7, since: '' } },
    });
    act(() => root.render(<ActivityKnowledge isAdmin={false} />));
    await flush();
    await flush();
    expect(container.textContent).toContain('Your input improved 2 things this week.');
    expect(apiGet).not.toHaveBeenCalledWith('/knowledge/admin-summary?days=7');
  });

  it('N = 0 → nothing at all', async () => {
    route({
      '/notifications/preferences': prefs(),
      '/knowledge/my-impact?days=7': { data: { count: 0, days: 7, since: '' } },
    });
    act(() => root.render(<ActivityKnowledge isAdmin={false} />));
    await flush();
    await flush();
    expect(container.innerHTML).toBe('');
  });

  it('flag off → no knowledge requests and nothing rendered', async () => {
    route({ '/notifications/preferences': prefs({}, false) });
    act(() => root.render(<ActivityKnowledge isAdmin />));
    await flush();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe('');
  });

  it('admins see the weekly card; switched off → not fetched', async () => {
    route({
      '/notifications/preferences': prefs({ knowledgeImpact: false }),
      '/knowledge/admin-summary?days=7': { data: summary },
    });
    act(() => root.render(<ActivityKnowledge isAdmin />));
    await flush();
    await flush();
    expect(container.textContent).toContain('This week in knowledge');
    expect(container.textContent).toContain('Ops has no team lead');
    expect(apiGet).not.toHaveBeenCalledWith('/knowledge/my-impact?days=7');

    act(() => root.unmount());
    root = createRoot(container);
    apiGet.mockClear();
    route({
      '/notifications/preferences': prefs({ adminWeeklySummary: false, knowledgeImpact: false }),
    });
    act(() => root.render(<ActivityKnowledge isAdmin />));
    await flush();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe('');
  });

  it('text helpers', () => {
    expect(impactText(0)).toBeNull();
    expect(impactText(1)).toBe('Your input improved 1 thing this week.');
    expect(
      areaText({
        reason: 'owner_left',
        teamId: null,
        teamName: null,
        memory: 1,
        routines: 0,
        items: [],
      }),
    ).toBe('Named owner left the org — 1 memory entry.');
    expect(
      areaText({
        reason: 'no_admin',
        teamId: null,
        teamName: null,
        memory: 0,
        routines: 2,
        items: [],
      }),
    ).toBe('No admin owns org items — 2 routines.');
  });
});
