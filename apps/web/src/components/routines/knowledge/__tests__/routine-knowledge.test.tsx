import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { RoutineDryRun, RoutineOwnership, RoutineTestCase } from '@hearth/shared';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ api }));

import { VersionHistory } from '../version-history';
import { RoutineOwner, ownerLine } from '../routine-owner';
import { TestCaseList, lastResultLabel, parsePhrases } from '../routine-tests';
import { DryRunResult } from '../dry-run-result';
import type { HistoryPage } from '@/hooks/use-routine-knowledge';
import { fetchRoutineHistory, testFailuresOf } from '@/hooks/use-routine-knowledge';

/**
 * Knowledge loop, Phase 4 web tests — prompt history (diff + restore), the
 * owner line, the test-case list and the dry-run result. Rendered with
 * react-dom/client on jsdom, like the Review card tests.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const f of Object.values(api)) f.mockReset();
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

const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
const buttonStarting = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith(text));

const history: HistoryPage = {
  currentVersion: 3,
  isOwner: true,
  total: 3,
  items: [
    {
      version: 3,
      text: 'Summarise tickets.\nFrom the Support queue.',
      changeSource: 'curator',
      changedByName: 'Dana Lee',
      restoredFrom: null,
      createdAt: new Date().toISOString(),
    },
    {
      version: 2,
      text: 'Summarise tickets.\nFrom #customers.',
      changeSource: 'user',
      changedByName: 'Sam Roe',
      restoredFrom: null,
      createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    },
    {
      version: 1,
      text: 'Summarise tickets.',
      changeSource: 'rollback',
      changedByName: null,
      restoredFrom: 4,
      createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    },
  ],
};

describe('VersionHistory', () => {
  it('lists versions newest first with who, how and when', async () => {
    await act(async () =>
      root.render(<VersionHistory noun="prompt" load={async () => history} restore={vi.fn()} />),
    );
    await flush();
    const rows = Array.from(container.querySelectorAll('li'));
    expect(rows.map((r) => r.querySelector('.font-mono')?.textContent)).toEqual(['v3', 'v2', 'v1']);
    expect(rows[0].textContent).toContain('Approved fix');
    expect(rows[0].textContent).toContain('Dana Lee');
    expect(rows[0].textContent).toContain('Current');
    expect(rows[1].textContent).toContain('Edited');
    expect(rows[1].textContent).toContain('2h ago');
    expect(rows[2].textContent).toContain('Restored from v4');
    expect(rows[2].textContent).toContain('Someone');
  });

  it('shows the diff against the previous version', async () => {
    await act(async () =>
      root.render(<VersionHistory noun="prompt" load={async () => history} restore={vi.fn()} />),
    );
    await flush();
    const show = buttonStarting('Show changes to the prompt (1 line added, 1 removed)');
    expect(show).toBeTruthy();
    act(() => show!.click());
    const lines = Array.from(container.querySelectorAll('[data-diff]'));
    expect(
      lines.map((l) => [
        l.getAttribute('data-diff'),
        l.textContent?.replace(/^[+−\s]+|Added: |Removed: /g, ''),
      ]),
    ).toEqual([
      ['same', 'Summarise tickets.'],
      ['del', 'From #customers.'],
      ['add', 'From the Support queue.'],
    ]);
    expect(buttonStarting('Show the first prompt')).toBeTruthy();
  });

  it('owners restore with an inline confirm; the current version has no restore', async () => {
    const restore = vi.fn(async () => ({}));
    const onRestored = vi.fn();
    await act(async () =>
      root.render(
        <VersionHistory
          noun="prompt"
          load={async () => history}
          restore={restore}
          onRestored={onRestored}
        />,
      ),
    );
    await flush();
    const restoreButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Restore this version',
    );
    expect(restoreButtons).toHaveLength(2); // v2 and v1, not v3
    act(() => restoreButtons[0].click());
    expect(container.textContent).toContain('Restore v2?');
    await act(async () => button('Restore')!.click());
    await flush();
    expect(restore).toHaveBeenCalledWith(2, false);
    expect(onRestored).toHaveBeenCalled();
  });

  it('a restore blocked by test cases lists why and offers "Restore anyway"', async () => {
    const restore = vi
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
    await act(async () =>
      root.render(<VersionHistory noun="prompt" load={async () => history} restore={restore} />),
    );
    await flush();
    act(() => button('Restore this version')!.click());
    await act(async () => button('Restore')!.click());
    await flush();
    expect(container.textContent).toContain('Keeps the Support queue');
    expect(container.textContent).toContain('no longer says "Support queue"');
    await act(async () => button('Restore anyway')!.click());
    await flush();
    expect(restore).toHaveBeenLastCalledWith(2, true);
  });

  it('non-owners see the history read-only', async () => {
    await act(async () =>
      root.render(
        <VersionHistory
          noun="prompt"
          load={async () => ({ ...history, isOwner: false })}
          restore={vi.fn()}
        />,
      ),
    );
    await flush();
    expect(button('Restore this version')).toBeUndefined();
    expect(container.textContent).toContain('Only an owner can restore');
  });

  it('maps the API response, including authors', async () => {
    api.get.mockResolvedValueOnce({
      data: [
        {
          version: 2,
          snapshot: { prompt: 'P2' },
          changeSource: 'user',
          changedBy: { id: 'u', name: 'Sam' },
          restoredFrom: null,
          createdAt: 'x',
        },
      ],
      total: 1,
      currentVersion: 2,
      isOwner: false,
    });
    const page = await fetchRoutineHistory('r1');
    expect(api.get).toHaveBeenCalledWith('/routines/r1/versions?pageSize=50');
    expect(page).toEqual({
      currentVersion: 2,
      isOwner: false,
      total: 1,
      items: [
        {
          version: 2,
          text: 'P2',
          changeSource: 'user',
          changedByName: 'Sam',
          restoredFrom: null,
          createdAt: 'x',
        },
      ],
    });
  });

  it('testFailuresOf only reads tests_failed answers', () => {
    expect(testFailuresOf({ status: 409, body: { code: 'version_conflict' } })).toBeNull();
    expect(testFailuresOf(new Error('x'))).toBeNull();
    expect(testFailuresOf({ status: 409, body: { code: 'tests_failed', failures: [] } })).toEqual(
      [],
    );
  });
});

const own: RoutineOwnership = {
  scope: 'team',
  defaultOwnerLabel: 'Engineering leads and admins',
  owner: null,
  isOwner: false,
  canChangeOwner: false,
};

describe('RoutineOwner', () => {
  it('ownerLine names the default owners, or the named owner plus them', () => {
    expect(ownerLine(own)).toBe('Engineering leads and admins');
    expect(ownerLine({ ...own, owner: { id: 'u', name: 'Dana Lee' } })).toBe(
      'Dana Lee, plus engineering leads and admins',
    );
  });

  it('members see the owner and no change button', async () => {
    await act(async () => root.render(<RoutineOwner routineId="r1" initial={own} />));
    expect(container.querySelector('[data-testid="owner-line"]')?.textContent).toBe(
      'Engineering leads and admins',
    );
    expect(button('Change owner')).toBeUndefined();
  });

  it('admins pick a named owner from org members', async () => {
    api.patch.mockResolvedValue({});
    api.get.mockResolvedValue({
      data: { ...own, canChangeOwner: true, owner: { id: 'u2', name: 'Sam Roe' } },
    });
    await act(async () =>
      root.render(
        <RoutineOwner
          routineId="r1"
          initial={{
            ...own,
            isOwner: true,
            canChangeOwner: true,
            candidates: [
              { id: 'u1', name: 'Dana Lee', role: 'team_lead' },
              { id: 'u2', name: 'Sam Roe', role: 'member' },
            ],
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('You are an owner.');
    act(() => button('Change owner')!.click());
    const select = container.querySelector('select')!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'No named owner',
      'Dana Lee',
      'Sam Roe',
    ]);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'u2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('Save')!.click());
    await flush();
    expect(api.patch).toHaveBeenCalledWith('/routines/r1/owner', { ownerId: 'u2' });
    expect(container.querySelector('[data-testid="owner-line"]')?.textContent).toBe(
      'Sam Roe, plus engineering leads and admins',
    );
  });
});

const tc = (over: Partial<RoutineTestCase> = {}): RoutineTestCase => ({
  id: 't1',
  routineId: 'r1',
  proposalId: 'p1',
  description: 'Keeps the Support queue',
  mustContain: ['Support queue', 'ticket_lookup'],
  source: 'proposal',
  createdById: 'u1',
  lastStatus: null,
  lastCheckedAt: null,
  lastMissing: null,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('TestCaseList', () => {
  it('shows each case, its phrases, where it came from and its last result', async () => {
    await act(async () =>
      root.render(
        <TestCaseList
          cases={[
            tc(),
            tc({
              id: 't2',
              source: 'manual',
              description: 'Mentions totals',
              mustContain: ['Total'],
              lastStatus: 'failed',
              lastMissing: ['Total'],
              lastCheckedAt: new Date().toISOString(),
            }),
          ]}
          canEdit={false}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    const rows = Array.from(container.querySelectorAll('li'));
    expect(rows[0].textContent).toContain('Not run yet');
    expect(rows[0].textContent).toContain('"Support queue", "ticket_lookup"');
    expect(rows[0].textContent).toContain('From an approved fix');
    expect(rows[1].textContent).toContain('Failed');
    expect(rows[1].textContent).toContain('Last output was missing "Total"');
    expect(rows[1].textContent).toContain('Added by an owner');
    expect(button('Edit')).toBeUndefined();
    expect(button('Delete')).toBeUndefined();
  });

  it('owners delete with an inline confirm', async () => {
    const onDelete = vi.fn(async () => {});
    await act(async () =>
      root.render(<TestCaseList cases={[tc()]} canEdit onEdit={vi.fn()} onDelete={onDelete} />),
    );
    act(() => button('Delete')!.click());
    expect(container.textContent).toContain('Delete this test case?');
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => button('Delete')!.click());
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('an empty list explains where cases come from', async () => {
    await act(async () =>
      root.render(<TestCaseList cases={[]} canEdit onEdit={vi.fn()} onDelete={vi.fn()} />),
    );
    expect(container.textContent).toContain(
      'Approving a fix to this routine adds one, or add your own',
    );
  });

  it('helpers', () => {
    expect(parsePhrases(' a \n\n b\n')).toEqual(['a', 'b']);
    expect(lastResultLabel({ lastStatus: 'passed', lastMissing: [] })).toEqual({
      tone: 'ok',
      text: 'Passed',
    });
  });
});

const run: RoutineDryRun = {
  id: 'd1',
  routineId: 'r1',
  kind: 'tests',
  status: 'success',
  candidatePrompt: 'Draft',
  routineVersion: 3,
  sourceRun: { id: 'run1', status: 'success', startedAt: '', error: null },
  lastOutput: 'Old output',
  output: 'New output',
  error: null,
  testResults: [
    { testCaseId: 't1', description: 'Keeps the queue', passed: true, missing: [] },
    { testCaseId: 't2', description: 'Mentions totals', passed: false, missing: ['Total'] },
  ],
  blockedTools: ['slack_post_message'],
  durationMs: 10,
  createdAt: '',
  completedAt: '',
  expiresAt: '',
};

describe('DryRunResult', () => {
  it('shows the last output next to the new one, what was held back, and test results', async () => {
    await act(async () => root.render(<DryRunResult run={run} />));
    const last = container.querySelector('[aria-label="Last run output"]')!;
    const fresh = container.querySelector('[aria-label="Dry run output"]')!;
    expect(last.textContent).toContain('Old output');
    expect(fresh.textContent).toContain('New output');
    expect(fresh.textContent).toContain('(your draft)');
    expect(container.textContent).toContain('Nothing was sent. Held back: slack_post_message.');
    expect(container.textContent).toContain('Missing: "Total"');
  });

  it('running and failed states', async () => {
    await act(async () => root.render(<DryRunResult run={{ ...run, status: 'running' }} />));
    expect(container.textContent).toContain('Running');
    await act(async () =>
      root.render(<DryRunResult run={{ ...run, status: 'failed', error: 'No model' }} />),
    );
    expect(container.textContent).toContain('The dry run failed: No model');
  });
});
