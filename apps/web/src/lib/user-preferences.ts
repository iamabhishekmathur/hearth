/**
 * W5 — tiny client-side user-preference read/write helper.
 *
 * Preferences are namespaced by user id and grouped into categories (e.g.
 * `model`), mirroring the existing `user.preferences` JSON bag on the server but
 * living client-side in `localStorage` (same pattern the chat nudges use). This
 * keeps the model picker's "remember my last model" behaviour out of the hot
 * `use-chat.ts` path and adds no table/migration/API route.
 *
 * Reads/writes are null-safe: SSR, private-mode quota errors, and malformed JSON
 * all degrade to "no stored preference" rather than throwing.
 */

const PREFIX = 'hearth.prefs';

function keyFor(userId: string, category: string): string {
  return `${PREFIX}.${userId}.${category}`;
}

/** Read a single string preference, or `null` if unset/unavailable. */
export function readPreference(userId: string | null | undefined, category: string): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(keyFor(userId, category));
  } catch {
    return null;
  }
}

/** Write (or, with `null`, clear) a single string preference. Never throws. */
export function writePreference(
  userId: string | null | undefined,
  category: string,
  value: string | null,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const k = keyFor(userId, category);
    if (value === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, value);
  } catch {
    // Quota/private-mode — selection simply won't persist across reloads.
  }
}

/** Preference category for the in-chat model picker's last selection. */
export const MODEL_PREFERENCE_CATEGORY = 'model';
