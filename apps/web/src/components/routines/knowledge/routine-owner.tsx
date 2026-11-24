import { useCallback, useEffect, useId, useState } from 'react';
import type { RoutineOwnership } from '@hearth/shared';
import { HButton } from '@/components/ui/primitives';
import { fetchOwnership, setRoutineOwner } from '@/hooks/use-routine-knowledge';

/**
 * Knowledge loop, Phase 4 — who owns a team or org routine. Owners review
 * fixes, restore versions, dry run and keep its test cases. Admins may name a
 * person as owner (in addition to the default owners).
 */

/** "Engineering leads and admins" / "Dana Lee, plus Admins". Pure, for tests. */
export function ownerLine(o: Pick<RoutineOwnership, 'defaultOwnerLabel' | 'owner'>): string {
  return o.owner
    ? `${o.owner.name}, plus ${o.defaultOwnerLabel.toLowerCase()}`
    : o.defaultOwnerLabel;
}

interface Props {
  routineId: string;
  /** Lets the parent show owner-only actions. */
  onLoaded?: (o: RoutineOwnership) => void;
  /** Pre-fetched ownership (tests); otherwise fetched. */
  initial?: RoutineOwnership;
}

export function RoutineOwner({ routineId, onLoaded, initial }: Props) {
  const [own, setOwn] = useState<RoutineOwnership | null>(initial ?? null);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();

  const load = useCallback(async () => {
    try {
      const o = await fetchOwnership(routineId);
      setOwn(o);
      onLoaded?.(o);
    } catch {
      setOwn(null);
    }
  }, [routineId, onLoaded]);

  useEffect(() => {
    if (initial) {
      onLoaded?.(initial);
      return;
    }
    void load();
  }, [load, initial, onLoaded]);

  if (!own) return null;

  const save = async (ownerId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await setRoutineOwner(routineId, ownerId);
      setEditing(false);
      await load();
    } catch (err) {
      setError((err as Error).message || 'Could not change the owner');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">
        Owner
      </h4>
      <p className="text-sm text-hearth-text" data-testid="owner-line">
        {ownerLine(own)}
      </p>
      {own.isOwner && <p className="text-xs text-hearth-text-faint">You are an owner.</p>}

      {own.canChangeOwner && !editing && (
        <button
          type="button"
          onClick={() => {
            setChoice(own.owner?.id ?? '');
            setEditing(true);
          }}
          className="mt-1 rounded text-xs font-medium text-hearth-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-hearth-600"
        >
          Change owner
        </button>
      )}

      {editing && (
        <div className="mt-2 space-y-2">
          <label htmlFor={selectId} className="block text-xs text-hearth-text-muted">
            Named owner (added to {own.defaultOwnerLabel.toLowerCase()})
          </label>
          <select
            id={selectId}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="w-full max-w-xs rounded-md border border-hearth-border-strong bg-hearth-card px-2 py-1.5 text-sm text-hearth-text"
          >
            <option value="">No named owner</option>
            {(own.candidates ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <HButton
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => save(choice || null)}
            >
              {busy ? 'Saving…' : 'Save'}
            </HButton>
            <HButton size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </HButton>
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
