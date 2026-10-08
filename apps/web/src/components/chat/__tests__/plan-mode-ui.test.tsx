import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { ChatMessage } from '@hearth/shared';

/**
 * W4 web test — the Plan/Build toggle (chat-input) and the plan card + Approve
 * & Build button (message-list). Rendered with react-dom/client on jsdom (no
 * extra test deps). Covers:
 *   - toggle hidden when planMode flag off; visible + toggles when on.
 *   - Tab toggles plan↔build and the chosen mode reaches onSend.
 *   - plan card renders N steps; Approve & Build enabled, calls back with msg id.
 *   - empty plan → "no plan" + Approve disabled (J3 degenerate-plan).
 *   - already-approved plan → button disabled.
 */

// Stub the socket + api + auth modules the components import, so nothing hits
// the network and useModelSelection stays inert (flag off → picker hidden).
vi.mock('@/lib/socket-client', () => ({
  emitTyping: vi.fn(), emitComposing: vi.fn(), emitHeartbeat: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(async () => ({ data: [] })) } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/use-model-selection', () => ({
  useModelSelection: () => ({
    disabledByFlag: true, loading: false, options: [], selectedModel: null,
    selectedModelId: null, isEmpty: true, select: vi.fn(),
  }),
}));

import { ChatInput } from '../chat-input';
import { MessageList } from '../message-list';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView, which MessageList calls on mount.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
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
  act(() => root.render(ui));
}

function q<T extends Element = Element>(sel: string): T | null {
  return container.querySelector<T>(sel);
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

describe('ChatInput — plan/build toggle (W4)', () => {
  it('hides the toggle when the planMode flag is off', () => {
    render(<ChatInput onSend={vi.fn()} planMode={false} />);
    expect(findButtonByText('Build')).toBeUndefined();
    expect(findButtonByText('Plan')).toBeUndefined();
  });

  it('shows a Build toggle by default when the flag is on', () => {
    render(<ChatInput onSend={vi.fn()} planMode />);
    expect(findButtonByText('Build')).toBeDefined();
  });

  it('clicking the toggle switches Build → Plan', () => {
    render(<ChatInput onSend={vi.fn()} planMode />);
    const toggle = findButtonByText('Build')!;
    act(() => toggle.click());
    expect(findButtonByText('Plan')).toBeDefined();
    expect(findButtonByText('Build')).toBeUndefined();
  });

  it('Tab toggles the mode and the chosen mode is sent through onSend', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} planMode />);

    const textarea = q<HTMLTextAreaElement>('textarea')!;
    // Type a message.
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'draft the update');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Tab → switch to plan.
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(findButtonByText('Plan')).toBeDefined();

    // Enter → send; onSend's 5th arg carries the mode.
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][4]).toBe('plan');
  });

  it('when the flag is off, onSend receives undefined mode (today’s build behavior)', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} planMode={false} />);
    const textarea = q<HTMLTextAreaElement>('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'hello');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSend.mock.calls[0][4]).toBeUndefined();
  });
});

function planMessage(plan: unknown): ChatMessage {
  return {
    id: 'msg_plan',
    sessionId: 'sess',
    role: 'assistant',
    content: 'Here is the plan.',
    metadata: { agentMode: 'plan', plan },
    createdAt: new Date().toISOString(),
  } as ChatMessage;
}

describe('MessageList — plan card + Approve & Build (W4)', () => {
  it('renders the numbered steps and an enabled Approve & Build button', () => {
    const onApproveBuild = vi.fn();
    render(
      <MessageList
        messages={[planMessage({ steps: [{ index: 1, text: 'Draft update' }, { index: 2, text: 'Send to #sales' }], approved: false })]}
        isStreaming={false}
        thinking={null}
        toolCalls={[]}
        planMode
        onApproveBuild={onApproveBuild}
      />,
    );
    const card = q('[data-testid="plan-card"]')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Draft update');
    expect(card.textContent).toContain('Send to #sales');

    const btn = q<HTMLButtonElement>('[data-testid="approve-build"]')!;
    expect(btn.disabled).toBe(false);
    act(() => btn.click());
    expect(onApproveBuild).toHaveBeenCalledWith('msg_plan');
  });

  it('J3 degenerate plan: empty steps → "no plan" and Approve disabled', () => {
    render(
      <MessageList
        messages={[planMessage({ steps: [], approved: false })]}
        isStreaming={false}
        thinking={null}
        toolCalls={[]}
        planMode
        onApproveBuild={vi.fn()}
      />,
    );
    const card = q('[data-testid="plan-card"]')!;
    expect(card.textContent?.toLowerCase()).toContain('no plan');
    expect(q<HTMLButtonElement>('[data-testid="approve-build"]')!.disabled).toBe(true);
  });

  it('already-approved plan disables the button (idempotent UI)', () => {
    render(
      <MessageList
        messages={[planMessage({ steps: [{ index: 1, text: 'x' }], approved: true })]}
        isStreaming={false}
        thinking={null}
        toolCalls={[]}
        planMode
        onApproveBuild={vi.fn()}
      />,
    );
    const btn = q<HTMLButtonElement>('[data-testid="approve-build"]')!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Building');
  });

  it('does not render the plan card when the planMode flag is off', () => {
    render(
      <MessageList
        messages={[planMessage({ steps: [{ index: 1, text: 'x' }], approved: false })]}
        isStreaming={false}
        thinking={null}
        toolCalls={[]}
        planMode={false}
        onApproveBuild={vi.fn()}
      />,
    );
    expect(q('[data-testid="plan-card"]')).toBeNull();
  });
});
