import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { updatedLabel } from '../source-updated';
import { renderWithCitations } from '../message-bubble';

/**
 * Knowledge loop, Phase 3 — the "updated" marker on chat sources. The server
 * only sets `recentlyUpdated` for memory changed in the last 7 days.
 */
describe('updatedLabel', () => {
  const now = new Date('2026-11-24T15:00:00');
  it('no marker unless the server set recentlyUpdated with a time', () => {
    expect(updatedLabel({}, now)).toBeNull();
    expect(
      updatedLabel({ recentlyUpdated: false, lastChangedAt: now.toISOString() }, now),
    ).toBeNull();
    expect(updatedLabel({ recentlyUpdated: true }, now)).toBeNull();
    expect(updatedLabel({ recentlyUpdated: true, lastChangedAt: 'nope' }, now)).toBeNull();
  });
  it('today / yesterday / N days ago', () => {
    const at = (d: string) => ({ recentlyUpdated: true, lastChangedAt: new Date(d).toISOString() });
    expect(updatedLabel(at('2026-11-24T08:00:00'), now)).toBe('updated today');
    expect(updatedLabel(at('2026-11-23T23:00:00'), now)).toBe('updated yesterday');
    expect(updatedLabel(at('2026-11-20T10:00:00'), now)).toBe('updated 4 days ago');
  });
});

describe('citation chip', () => {
  let container: HTMLDivElement;
  let root: Root;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  function render(node: React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<p>{node}</p>));
  }

  it('shows "updated" only on the recently changed source', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    render(
      renderWithCitations('Post it in the channel [1] and tag the owner [2].', [
        {
          index: 1,
          type: 'context',
          label: 'org context',
          content: 'Customer update steps',
          recentlyUpdated: true,
          lastChangedAt: yesterday,
        },
        { index: 2, type: 'memory', label: 'User memory', content: 'Tag Ada' },
      ]),
    );
    const chips = Array.from(container.querySelectorAll('span[title]'));
    expect(chips).toHaveLength(2);
    expect(chips[0].getAttribute('data-updated')).toBe('true');
    expect(chips[0].textContent).toContain('updated');
    expect(chips[0].getAttribute('title')).toContain('org context · updated yesterday');
    expect(chips[1].getAttribute('data-updated')).toBeNull();
    expect(chips[1].textContent).toBe('2');
  });
});
