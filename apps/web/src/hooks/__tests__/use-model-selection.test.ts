import { describe, it, expect, beforeEach } from 'vitest';
import type { ModelPickerEntry } from '@hearth/shared';
import { deriveSelectability, reasonForUnselectable } from '../use-model-selection';
import {
  readPreference,
  writePreference,
  MODEL_PREFERENCE_CATEGORY,
} from '@/lib/user-preferences';
import { formatContextWindow } from '@/components/chat/chat-input';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OPUS: ModelPickerEntry = {
  id: 'claude-opus-4-8',
  providerId: 'anthropic',
  contextWindow: 1_000_000,
  caps: { vision: true, tools: true, reasoning: true },
  costHint: '$$$',
  allowedForRole: true,
};
const HAIKU_BLOCKED: ModelPickerEntry = {
  id: 'claude-haiku-4-5-20251001',
  providerId: 'anthropic',
  contextWindow: 200_000,
  caps: { vision: true, tools: true, reasoning: false },
  costHint: '$',
  allowedForRole: false, // not allowlisted for this role
};
const LLAMA_NO_VISION: ModelPickerEntry = {
  id: 'llama3.1',
  providerId: 'ollama',
  contextWindow: 128_000,
  caps: { vision: false, tools: true, reasoning: false },
  allowedForRole: true,
};

// ── deriveSelectability / reasonForUnselectable (picker "renders from /models") ─

describe('deriveSelectability', () => {
  it('marks allowlist-blocked models unselectable with a reason', () => {
    const [opus, haiku] = deriveSelectability([OPUS, HAIKU_BLOCKED], false);
    expect(opus.selectable).toBe(true);
    expect(haiku.selectable).toBe(false);
    expect(haiku.reason).toBe('Not allowed for your role');
  });

  it('marks non-vision models unselectable when an image is attached (vision gate)', () => {
    const withoutImage = deriveSelectability([LLAMA_NO_VISION], false);
    expect(withoutImage[0].selectable).toBe(true);

    const withImage = deriveSelectability([LLAMA_NO_VISION], true);
    expect(withImage[0].selectable).toBe(false);
    expect(withImage[0].reason).toBe('No image support');
  });

  it('vision-capable models stay selectable with an image attached', () => {
    const [opus] = deriveSelectability([OPUS], true);
    expect(opus.selectable).toBe(true);
  });

  it('role block takes precedence over vision when both apply', () => {
    const blockedNoVision: ModelPickerEntry = { ...LLAMA_NO_VISION, allowedForRole: false };
    expect(reasonForUnselectable(blockedNoVision, true)).toBe('Not allowed for your role');
  });
});

// ── persistence via the user_preferences (category 'model') mechanism ────────

describe('model preference persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists and reads back the last selection per user', () => {
    expect(readPreference('user-1', MODEL_PREFERENCE_CATEGORY)).toBeNull();
    writePreference('user-1', MODEL_PREFERENCE_CATEGORY, 'claude-opus-4-8');
    expect(readPreference('user-1', MODEL_PREFERENCE_CATEGORY)).toBe('claude-opus-4-8');
  });

  it('namespaces preferences by user id', () => {
    writePreference('user-1', MODEL_PREFERENCE_CATEGORY, 'gpt-4o');
    expect(readPreference('user-2', MODEL_PREFERENCE_CATEGORY)).toBeNull();
  });

  it('clearing with null removes the stored value', () => {
    writePreference('user-1', MODEL_PREFERENCE_CATEGORY, 'gpt-4o');
    writePreference('user-1', MODEL_PREFERENCE_CATEGORY, null);
    expect(readPreference('user-1', MODEL_PREFERENCE_CATEGORY)).toBeNull();
  });

  it('is null-safe for a missing user id', () => {
    expect(readPreference(null, MODEL_PREFERENCE_CATEGORY)).toBeNull();
    expect(() => writePreference(undefined, MODEL_PREFERENCE_CATEGORY, 'x')).not.toThrow();
  });
});

// ── context-window label ───────────────────────────────────────────────────

describe('formatContextWindow', () => {
  it('compacts token counts', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M ctx');
    expect(formatContextWindow(200_000)).toBe('200K ctx');
    expect(formatContextWindow(128_000)).toBe('128K ctx');
    expect(formatContextWindow(0)).toBe('');
  });
});
