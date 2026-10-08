import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelPickerEntry } from '@hearth/shared';
import { api, ApiError } from '@/lib/api-client';
import {
  MODEL_PREFERENCE_CATEGORY,
  readPreference,
  writePreference,
} from '@/lib/user-preferences';

/**
 * W5 — in-chat model-selection store/hook.
 *
 * Owns the catalog fetched from `GET /api/v1/models`, the user's current
 * selection, and selectability (role allowlist + vision gating). The selection
 * is persisted per-user via the `model` preference category. This hook is
 * deliberately decoupled from `use-chat.ts`: it exposes `selectedModelId` so the
 * send path (W-integration) can read it when building `sendMessage`, without this
 * hook touching the chat transport.
 */

/** A picker row with its computed selectability for the current attachment state. */
export interface PickerOption {
  entry: ModelPickerEntry;
  selectable: boolean;
  /** Human-readable reason when `selectable === false` (for a disabled-row tooltip). */
  reason?: string;
}

/**
 * Pure: why (if at all) a catalog entry is unselectable in the current context.
 * `hasImageAttachment` marks non-vision models unselectable (W1 `caps.vision`).
 * Returns `undefined` when the entry is selectable.
 */
export function reasonForUnselectable(
  entry: ModelPickerEntry,
  hasImageAttachment: boolean,
): string | undefined {
  if (!entry.allowedForRole) return 'Not allowed for your role';
  if (hasImageAttachment && !entry.caps.vision) return 'No image support';
  return undefined;
}

/**
 * Pure: annotate catalog entries with selectability for the current attachment
 * state. Extracted so the picker UI and its tests share one source of truth.
 */
export function deriveSelectability(
  entries: ModelPickerEntry[],
  hasImageAttachment: boolean,
): PickerOption[] {
  return entries.map((entry) => {
    const reason = reasonForUnselectable(entry, hasImageAttachment);
    return reason ? { entry, selectable: false, reason } : { entry, selectable: true };
  });
}

interface ModelsResponse {
  data: ModelPickerEntry[];
}

export interface UseModelSelection {
  /** All picker entries from the server (enabled providers only). */
  models: ModelPickerEntry[];
  /** Entries annotated with selectability for the current attachment state. */
  options: PickerOption[];
  /** The currently selected model id (persisted), or null when none chosen. */
  selectedModelId: string | null;
  /** The selected entry, or undefined if the selection isn't in the catalog. */
  selectedModel: ModelPickerEntry | undefined;
  /** Choose a model (no-op if the id isn't selectable). Persists per-user. */
  select: (modelId: string) => void;
  loading: boolean;
  error: string | null;
  /** True when the org has no enabled providers (picker shows an empty state). */
  isEmpty: boolean;
  /** Re-fetch the catalog (e.g. after an admin toggles a provider mid-session). */
  refresh: () => void;
  /** True when the feature flag is off server-side (picker should stay hidden). */
  disabledByFlag: boolean;
}

/**
 * @param userId current user id (namespaces the persisted selection)
 * @param hasImageAttachment whether the composer currently has an image attached
 * @param enabled when false, the hook does not fetch (e.g. no active session)
 */
export function useModelSelection(
  userId: string | null | undefined,
  hasImageAttachment: boolean,
  enabled = true,
): UseModelSelection {
  const [models, setModels] = useState<ModelPickerEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() =>
    readPreference(userId, MODEL_PREFERENCE_CATEGORY),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabledByFlag, setDisabledByFlag] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<ModelsResponse>('/models')
      .then((res) => {
        if (cancelled) return;
        setModels(res.data ?? []);
        setDisabledByFlag(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 = feature flag off for this org: keep the picker hidden, not errored.
        if (err instanceof ApiError && err.status === 404) {
          setDisabledByFlag(true);
          setModels([]);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load models');
        setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  // Re-hydrate the persisted selection when the user changes.
  useEffect(() => {
    setSelectedModelId(readPreference(userId, MODEL_PREFERENCE_CATEGORY));
  }, [userId]);

  const options = useMemo(
    () => deriveSelectability(models, hasImageAttachment),
    [models, hasImageAttachment],
  );

  const select = useCallback(
    (modelId: string) => {
      const option = options.find((o) => o.entry.id === modelId);
      if (!option || !option.selectable) return; // can't pick a disabled/unknown model
      setSelectedModelId(modelId);
      writePreference(userId, MODEL_PREFERENCE_CATEGORY, modelId);
    },
    [options, userId],
  );

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId],
  );

  const isEmpty = !loading && !error && models.length === 0 && !disabledByFlag;

  return {
    models,
    options,
    selectedModelId,
    selectedModel,
    select,
    loading,
    error,
    isEmpty,
    refresh,
    disabledByFlag,
  };
}
