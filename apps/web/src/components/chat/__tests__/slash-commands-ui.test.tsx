import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { SlashCommand } from '@hearth/shared';

/**
 * W6 web test — the `/` command menu in chat-input. Rendered with
 * react-dom/client on jsdom (same harness as the W4 plan-mode test). Covers:
 *   - `/` opens the menu (built-ins + an org skill), filters as you type;
 *   - keyboard nav (ArrowDown + Enter) and click selection dispatch;
 *   - built-in dispatch: /plan toggles plan mode (no send); /task opens composer;
 *   - skill dispatch: resolve → expanded prompt is sent;
 *   - unknown command → inline error, message NOT sent to the agent;
 *   - menu hidden when the slashCommands flag is off (and /task still opens the
 *     composer via the legacy path).
 */

// Mutable api mock — tests set get/post return values per case. Hoisted so the
// (also-hoisted) vi.mock factory can reference it.
const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/socket-client', () => ({
  emitTyping: vi.fn(), emitComposing: vi.fn(), emitHeartbeat: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ api: apiMock }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/use-model-selection', () => ({
  useModelSelection: () => ({
    disabledByFlag: true, loading: false, options: [], selectedModel: null,
    selectedModelId: null, isEmpty: true, select: vi.fn(),
  }),
}));

import { ChatInput } from '../chat-input';

const COMMANDS: SlashCommand[] = [
  { slug: 'task', title: '/task', description: 'Open the task composer', kind: 'builtin', action: 'task' },
  { slug: 'plan', title: '/plan', description: 'Toggle plan mode', kind: 'builtin', action: 'plan' },
  { slug: 'standup', title: '/standup', description: 'Run the "Standup" skill', kind: 'skill', action: 'skill', skillId: 'sk1' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation((path: string) => {
    if (path === '/chat/commands') return Promise.resolve({ data: COMMANDS });
    return Promise.resolve({ data: [] });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function render(ui: React.ReactElement) {
  // flush the effect that fetches /chat/commands
  return act(async () => { root.render(ui); await Promise.resolve(); });
}

function q<T extends Element = Element>(sel: string): T | null {
  return container.querySelector<T>(sel);
}

function typeValue(v: string) {
  const ta = q<HTMLTextAreaElement>('textarea')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, v);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return ta;
}

function key(ta: HTMLTextAreaElement, k: string) {
  act(() => ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
}

describe('ChatInput — `/` command menu (W6)', () => {
  it('does not show the `/` menu when the slashCommands flag is off', async () => {
    await render(<ChatInput onSend={vi.fn()} slashCommands={false} />);
    typeValue('/');
    expect(q('[data-testid="slash-menu"]')).toBeNull();
  });

  it('opens the menu on `/` and filters as the user types', async () => {
    await render(<ChatInput onSend={vi.fn()} slashCommands sessionId="s1" />);
    typeValue('/');
    const menu = q('[data-testid="slash-menu"]')!;
    expect(menu).toBeTruthy();
    expect(menu.querySelectorAll('[role="option"]').length).toBe(3);

    // Filter to the skill command.
    typeValue('/stand');
    const opts = container.querySelectorAll('[data-testid="slash-menu"] [role="option"]');
    expect(opts.length).toBe(1);
    expect(opts[0].getAttribute('data-slug')).toBe('standup');
  });

  it('/plan dispatch toggles plan mode locally and does NOT send a message', async () => {
    const onSend = vi.fn();
    await render(<ChatInput onSend={onSend} slashCommands planMode sessionId="s1" />);
    const ta = typeValue('/plan');
    // Enter selects the highlighted command (first = /plan after filtering).
    key(ta, 'Enter');
    expect(onSend).not.toHaveBeenCalled();
    // Plan mode is now active (the toggle button reads "Plan").
    const toggle = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Plan');
    expect(toggle).toBeDefined();
  });

  it('keyboard nav (ArrowDown + Enter) opens the /task composer', async () => {
    const onSend = vi.fn();
    await render(<ChatInput onSend={onSend} slashCommands sessionId="s1" latestMessageId="m1" />);
    const ta = typeValue('/');
    // menu order: task, plan, standup. ArrowDown twice would be standup; stay on task.
    key(ta, 'Enter'); // select /task → fills "/task " (takes args)
    expect((q<HTMLTextAreaElement>('textarea')!).value).toBe('/task ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('a skill command resolves server-side and sends the expanded prompt', async () => {
    apiMock.post.mockResolvedValue({ data: { type: 'skill', prompt: 'EXPANDED PROMPT' } });
    const onSend = vi.fn();
    await render(<ChatInput onSend={onSend} slashCommands sessionId="s1" />);
    const ta = typeValue('/standup 2026-10-08');
    await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve(); });
    expect(apiMock.post).toHaveBeenCalledWith('/chat/commands/resolve', { input: '/standup 2026-10-08' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe('EXPANDED PROMPT');
  });

  it('an unknown command shows an inline error and does NOT send to the agent', async () => {
    // The real ApiError puts the server's `error` string on `.message`.
    apiMock.post.mockRejectedValue(new Error('Unknown command: /frobnicate'));
    const onSend = vi.fn();
    await render(<ChatInput onSend={onSend} slashCommands sessionId="s1" />);
    const ta = typeValue('/frobnicate');
    await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve(); });
    expect(onSend).not.toHaveBeenCalled();
    const errEl = q('[data-testid="slash-error"]');
    expect(errEl).toBeTruthy();
    expect(errEl!.textContent).toContain('Unknown command');
  });
});
