import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { KnowledgeProposal } from '@hearth/shared';
import { ProposalCard } from '../proposal-card';

/**
 * Knowledge loop web test — the Review card. Rendered with react-dom/client on
 * jsdom (no extra test deps), like the plan-mode tests.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const base: KnowledgeProposal = {
  id: 'p1',
  targetType: 'memory',
  targetId: 'm1',
  targetName: 'Org memory: Weekly customer updates',
  ownerLabel: 'Admins',
  targetVersion: 1,
  before: 'Updates go in #customers.',
  after: 'Updates go in #customer-updates.',
  reason: 'The channel was renamed.',
  affected: { audience: 'org' },
  status: 'pending',
  availableAt: '2026-11-24T04:00:00.000Z',
  reviewedById: null,
  reviewedAt: null,
  rejectReason: null,
  editedAfter: null,
  resultVersion: null,
  createdAt: '2026-11-24T04:00:00.000Z',
  evidence: {
    counts: { empty_search: 3, correction: 2 },
    people: 3,
    items: [
      {
        kind: 'correction',
        source: 'chat',
        createdAt: '',
        label: 'A member corrected an answer.',
        quote: null,
        link: null,
      },
      {
        kind: 'correction',
        source: 'chat',
        createdAt: '',
        label: 'A member corrected an answer.',
        quote: 'It is #customer-updates now',
        link: { type: 'session', sessionId: 's9' },
      },
    ],
  },
};

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function render(props: Partial<React.ComponentProps<typeof ProposalCard>> = {}) {
  const onApprove = props.onApprove ?? vi.fn(async () => ({}));
  const onReject = props.onReject ?? vi.fn(async () => ({}));
  const onDone = props.onDone ?? vi.fn();
  act(() =>
    root.render(
      <ProposalCard
        proposal={props.proposal ?? base}
        onApprove={onApprove}
        onReject={onReject}
        onDone={onDone}
      />,
    ),
  );
  return { onApprove, onReject, onDone };
}

const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;

function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const text = () => container.textContent ?? '';

describe('ProposalCard — content', () => {
  it('shows the header, owner and target kind', () => {
    render();
    expect(text()).toContain('Proposal from the curator');
    expect(container.querySelector('h2')?.textContent).toBe('Org memory: Weekly customer updates');
    expect(text()).toContain('Owner: Admins');
    expect(text()).toContain('Memory');
  });

  it('shows before and after side by side (stacks on small screens)', () => {
    render();
    expect(text()).toContain('Updates go in #customers.');
    expect(text()).toContain('Updates go in #customer-updates.');
    const grid = container.querySelector('.grid');
    expect(grid?.className).toContain('grid-cols-1');
    expect(grid?.className).toContain('sm:grid-cols-2');
  });

  it('shows why: the reason, the counts sentence, and evidence', () => {
    render();
    expect(text()).toContain('The channel was renamed.');
    expect(text()).toContain('3 agents flagged a gap. 2 people corrected an answer.');
  });

  it('a private-chat item shows no quote and no link; a visible one shows both', () => {
    render();
    const items = container.querySelectorAll('li');
    expect(items[0].textContent).toBe('A member corrected an answer.');
    expect(items[0].querySelector('a')).toBeNull();
    expect(items[1].textContent).toContain('“It is #customer-updates now”');
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe('#/chat/s9');
  });

  it('shows who it affects', () => {
    render({
      proposal: {
        ...base,
        targetType: 'routine',
        affected: {
          audience: 'team',
          teamName: 'Support',
          routines: [{ id: 'r', name: 'Daily brief' }],
        },
      },
    });
    expect(text()).toContain('Everyone on the Support team, through the routine Daily brief.');
    expect(text()).toContain('Routine prompt');
  });

  it('has a labelled article and uses the fade-in entrance', () => {
    render();
    const article = container.querySelector('article')!;
    expect(article.getAttribute('aria-labelledby')).toBe('proposal-p1-title');
    expect(article.className).toContain('animate-fade-in');
  });

  it('all actions are real buttons (keyboard reachable)', () => {
    render();
    for (const label of ['Approve', 'Edit', 'Reject']) {
      expect(button(label)?.tagName).toBe('BUTTON');
    }
  });
});

describe('ProposalCard — approve / edit', () => {
  it('Approve sends no edits and removes the card', async () => {
    const { onApprove, onDone } = render();
    await act(async () => button('Approve')!.click());
    await flush();
    expect(onApprove).toHaveBeenCalledWith('p1', {});
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('Edit opens a focused textarea; Save and approve sends the edited text', async () => {
    const { onApprove } = render();
    act(() => button('Edit')!.click());
    const ta = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edited text"]')!;
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe(base.after);
    type(ta, 'Updates go in #customer-updates by noon.');
    await act(async () => button('Save and approve')!.click());
    await flush();
    expect(onApprove).toHaveBeenCalledWith('p1', {
      after: 'Updates go in #customer-updates by noon.',
    });
  });

  it('saving an unchanged edit is a plain approval', async () => {
    const { onApprove } = render();
    act(() => button('Edit')!.click());
    await act(async () => button('Save and approve')!.click());
    await flush();
    expect(onApprove).toHaveBeenCalledWith('p1', {});
  });

  it('Save is disabled for empty text', () => {
    render();
    act(() => button('Edit')!.click());
    type(container.querySelector<HTMLTextAreaElement>('textarea')!, '   ');
    expect(button('Save and approve')!.disabled).toBe(true);
  });

  it('Escape cancels an edit and restores the proposal', () => {
    render();
    act(() => button('Edit')!.click());
    const ta = container.querySelector<HTMLTextAreaElement>('textarea')!;
    type(ta, 'something else');
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('textarea')).toBeNull();
    expect(button('Approve')).toBeDefined();
    expect(text()).toContain(base.after);
  });
});

describe('ProposalCard — reject', () => {
  it('Reject asks for an optional reason and sends it', async () => {
    const { onReject, onDone } = render();
    act(() => button('Reject')!.click());
    const ta = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Reason for rejecting"]',
    )!;
    expect(document.activeElement).toBe(ta);
    type(ta, '  We still use #customers  ');
    await act(async () => button('Reject proposal')!.click());
    await flush();
    expect(onReject).toHaveBeenCalledWith('p1', 'We still use #customers');
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('rejecting with no reason sends undefined', async () => {
    const { onReject } = render();
    act(() => button('Reject')!.click());
    await act(async () => button('Reject proposal')!.click());
    await flush();
    expect(onReject).toHaveBeenCalledWith('p1', undefined);
  });

  it('Cancel leaves reject mode without calling anything', () => {
    const { onReject } = render();
    act(() => button('Reject')!.click());
    act(() => button('Cancel')!.click());
    expect(onReject).not.toHaveBeenCalled();
    expect(button('Approve')).toBeDefined();
  });
});

describe('ProposalCard — errors', () => {
  it('a version conflict shows the current text and approves on the new version next', async () => {
    const onApprove = vi
      .fn()
      .mockRejectedValueOnce({
        status: 409,
        message: 'changed',
        body: { code: 'version_conflict', currentVersion: 3, currentContent: 'Updates go in #cx.' },
      })
      .mockResolvedValueOnce({});
    const { onDone } = render({ onApprove });
    await act(async () => button('Approve')!.click());
    await flush();
    expect(onDone).not.toHaveBeenCalled();
    expect(text()).toContain('Updates go in #cx.');
    expect(text()).toContain('Now (changed since)');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => button('Approve on new version')!.click());
    await flush();
    expect(onApprove).toHaveBeenLastCalledWith('p1', { baseVersion: 3 });
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('a fix that breaks a routine test case stays, explains why, and can be approved anyway', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onApprove = vi
      .fn()
      .mockRejectedValueOnce({
        status: 409,
        message: 'This change removes text that a test case needs.',
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
      })
      .mockResolvedValueOnce({});
    const { onDone } = render({ onApprove });
    await act(async () => button('Approve')!.click());
    await flush();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(text()).toContain('Keeps the Support queue');
    expect(text()).toContain('no longer says "Support queue"');
    await act(async () => button('Approve anyway')!.click());
    await flush();
    expect(onApprove).toHaveBeenLastCalledWith('p1', { overrideTests: true });
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('already decided elsewhere: says so, then leaves the inbox', async () => {
    vi.useFakeTimers();
    const onApprove = vi
      .fn()
      .mockRejectedValue({
        status: 409,
        message: 'This proposal was already decided',
        body: { code: 'already_decided' },
      });
    const { onDone } = render({ onApprove });
    await act(async () => button('Approve')!.click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'This proposal was already decided',
    );
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1600));
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('a deleted target (410) also leaves the inbox', async () => {
    vi.useFakeTimers();
    const onApprove = vi.fn().mockRejectedValue({ status: 410, message: 'deleted' });
    const { onDone } = render({ onApprove });
    await act(async () => button('Approve')!.click());
    await flush();
    act(() => vi.advanceTimersByTime(1600));
    expect(onDone).toHaveBeenCalledWith('p1');
  });

  it('a network error keeps the card and shows the message', async () => {
    const onApprove = vi.fn().mockRejectedValue({ status: 500, message: 'Server error' });
    const { onDone } = render({ onApprove });
    await act(async () => button('Approve')!.click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Server error');
    expect(onDone).not.toHaveBeenCalled();
    expect(button('Approve')!.disabled).toBe(false);
  });

  it('buttons are disabled while a decision is in flight', async () => {
    let resolve!: () => void;
    const onApprove = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render({ onApprove });
    await act(async () => button('Approve')!.click());
    expect(button('Approve')!.disabled).toBe(true);
    expect(button('Edit')!.disabled).toBe(true);
    await act(async () => resolve());
  });
});
