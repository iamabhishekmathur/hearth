import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

/**
 * The Review nav entry and page exist only when the org's `knowledgeLoop`
 * flag is on; with it off the page says so and members see nothing new.
 */
const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ api: { get: apiGet, post: vi.fn() } }));
vi.mock('@/extensions/register', () => ({ getExtensionNavItems: () => [] }));

import { Sidebar } from '@/components/layout/sidebar';
import { ReviewPage } from '@/pages/review';
import { resetFeatureCache } from '@/hooks/use-knowledge';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetFeatureCache();
  apiGet.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const user = { id: 'u1', name: 'Ada Admin', email: 'a@x', role: 'admin' } as never;
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const navLabels = () =>
  Array.from(container.querySelectorAll('nav ~ div button[title], nav button[title]')).map((b) =>
    b.getAttribute('title'),
  );

describe('Review nav entry', () => {
  it('is hidden when the flag is off', async () => {
    apiGet.mockResolvedValue({ data: { planMode: true } });
    act(() =>
      root.render(
        <Sidebar user={user} currentRoute="/chat" onNavigate={vi.fn()} onLogout={vi.fn()} />,
      ),
    );
    await flush();
    expect(navLabels()).not.toContain('Review');
    expect(apiGet).toHaveBeenCalledWith('/chat/features');
  });

  it('is shown when the flag is on and navigates to #/review', async () => {
    apiGet.mockResolvedValue({ data: { knowledgeLoop: true } });
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <Sidebar user={user} currentRoute="/chat" onNavigate={onNavigate} onLogout={vi.fn()} />,
      ),
    );
    await flush();
    const review = container.querySelector<HTMLButtonElement>('button[title="Review"]');
    expect(review).not.toBeNull();
    act(() => review!.click());
    expect(onNavigate).toHaveBeenCalledWith('/review');
  });

  it('stays hidden when the flags cannot be loaded', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    act(() =>
      root.render(
        <Sidebar user={user} currentRoute="/chat" onNavigate={vi.fn()} onLogout={vi.fn()} />,
      ),
    );
    await flush();
    expect(container.querySelector('button[title="Review"]')).toBeNull();
  });
});

describe('Review page', () => {
  it('flag off (404) → says Review is not on', async () => {
    apiGet.mockRejectedValue({ status: 404, message: 'Proposal not found' });
    act(() => root.render(<ReviewPage />));
    await flush();
    expect(container.textContent).toContain('Review is not turned on for your organization.');
  });

  it('no cards → calm empty state', async () => {
    apiGet.mockResolvedValue({ data: [] });
    act(() => root.render(<ReviewPage />));
    await flush();
    expect(container.textContent).toContain('Nothing to review');
  });

  it('server error → alert', async () => {
    apiGet.mockRejectedValue({ status: 500, message: 'boom' });
    act(() => root.render(<ReviewPage />));
    await flush();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('lists one card per proposal', async () => {
    const card = {
      id: 'p1',
      targetType: 'memory',
      targetId: 'm',
      targetName: 'Org memory: X',
      ownerLabel: 'Admins',
      targetVersion: 1,
      before: 'a',
      after: 'b',
      reason: 'r',
      affected: { audience: 'org' },
      status: 'pending',
      availableAt: '',
      reviewedById: null,
      reviewedAt: null,
      rejectReason: null,
      editedAfter: null,
      resultVersion: null,
      createdAt: '',
      evidence: { counts: {}, people: 0, items: [] },
    };
    apiGet.mockResolvedValue({ data: [card, { ...card, id: 'p2' }] });
    act(() => root.render(<ReviewPage />));
    await flush();
    expect(container.querySelectorAll('article')).toHaveLength(2);
    expect(apiGet).toHaveBeenCalledWith('/knowledge/proposals');
  });
});
