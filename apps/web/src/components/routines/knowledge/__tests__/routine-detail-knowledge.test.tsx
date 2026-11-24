import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Routine } from '@hearth/shared';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
const flags = vi.hoisted(() => ({ knowledgeLoop: false }));
vi.mock('@/lib/api-client', () => ({ api }));

import { RoutineDetail } from '../../routine-detail';
import { resetFeatureCache } from '@/hooks/use-knowledge';

/**
 * Knowledge loop, Phase 4 — the routine panel: the new tabs and the owner
 * line appear only with the org flag on, and a save blocked by test cases
 * shows why with a "Save anyway".
 */

let container: HTMLDivElement;
let root: Root;

const routine: Routine = {
  id: 'r1',
  userId: 'u1',
  name: 'Ticket digest',
  description: null,
  prompt: 'Summarise tickets from the Support queue.',
  schedule: '0 9 * * 1-5',
  context: {},
  delivery: {},
  enabled: true,
  lastRunAt: null,
  lastRunStatus: null,
  createdVia: 'manual',
  createdAt: '',
  updatedAt: '',
  scope: 'team',
  teamId: 't1',
  orgId: 'o1',
  version: 2,
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  resetFeatureCache();
  for (const f of Object.values(api)) f.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path === '/chat/features') return { data: { knowledgeLoop: flags.knowledgeLoop } };
    if (path === '/routines/r1/ownership') {
      return {
        data: {
          scope: 'team',
          defaultOwnerLabel: 'Engineering leads and admins',
          owner: null,
          isOwner: true,
          canChangeOwner: false,
        },
      };
    }
    return { data: [] };
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const tabs = () => Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

function render(onUpdate = vi.fn(async () => ({}))) {
  return act(async () =>
    root.render(
      <RoutineDetail
        routine={routine}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onRunNow={vi.fn()}
        fetchRuns={vi.fn(async () => ({ data: [], total: 0 }))}
        onClose={vi.fn()}
      />,
    ),
  );
}

describe('RoutineDetail with the knowledge loop', () => {
  it('flag off: no Versions / Tests tabs and no owner line', async () => {
    flags.knowledgeLoop = false;
    await render();
    await flush();
    expect(tabs()).toEqual(['Overview', 'Run History', 'State']);
    expect(container.textContent).not.toContain('Engineering leads and admins');
  });

  it('flag on: Versions and Tests tabs, and the owner of a team routine', async () => {
    flags.knowledgeLoop = true;
    await render();
    await flush();
    await flush();
    expect(tabs()).toEqual(['Overview', 'Run History', 'Versions', 'Tests', 'State']);
    expect(container.querySelector('[data-testid="owner-line"]')?.textContent).toBe(
      'Engineering leads and admins',
    );
  });

  it('a save blocked by tests lists why; "Save anyway" resends with overrideTests', async () => {
    flags.knowledgeLoop = true;
    const onUpdate = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('blocked'), {
          status: 409,
          body: {
            code: 'tests_failed',
            failures: [
              {
                testCaseId: 't1',
                description: 'Keeps the Support queue',
                missing: ['Support queue'],
                reason: 'The new prompt no longer says "Support queue".',
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce({});
    await render(onUpdate);
    await flush();
    act(() => button('Edit')!.click());
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('This change breaks a test case');
    expect(container.textContent).toContain('no longer says "Support queue"');
    await act(async () => button('Save anyway')!.click());
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[1][1]).toMatchObject({ overrideTests: true });
    // Saved: back to the overview.
    expect(container.querySelector('form')).toBeNull();
  });
});
