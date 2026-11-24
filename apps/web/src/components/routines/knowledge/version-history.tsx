import { useCallback, useEffect, useState } from 'react';
import type { RoutineTestFailure } from '@hearth/shared';
import { HBadge, HButton } from '@/components/ui/primitives';
import { lineDiff, diffSummary, type DiffLine } from '@/lib/line-diff';
import {
  sourceLabel,
  testFailuresOf,
  type HistoryItem,
  type HistoryPage,
} from '@/hooks/use-routine-knowledge';
import { TestFailureList } from './test-failure-list';

/**
 * Knowledge loop, Phase 4 — the history of a routine's prompt (or a memory
 * entry's text). Newest first. Each version shows who changed it, when, how,
 * and what changed compared with the version before it. Owners can restore an
 * older version; the confirm is inline (no browser dialog). Everyone else
 * sees the list read-only.
 */

interface Props {
  /** What the text is, in the sentence "Show changes to the …". */
  noun: 'prompt' | 'text';
  load: () => Promise<HistoryPage>;
  /** Restore `version`. Throws on failure (a 409 tests_failed is shown with a "restore anyway"). */
  restore: (version: number, overrideTests: boolean) => Promise<unknown>;
  /** Called after a successful restore. */
  onRestored?: () => void;
}

function when(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre
      className="max-h-72 overflow-auto rounded-md border border-hearth-border bg-hearth-bg p-2 font-mono text-xs leading-relaxed"
      aria-label="Changes"
    >
      {lines.map((l, i) => (
        <div
          key={i}
          data-diff={l.type}
          className={
            l.type === 'add'
              ? 'whitespace-pre-wrap bg-green-50 text-green-800'
              : l.type === 'del'
                ? 'whitespace-pre-wrap bg-red-50 text-red-700 line-through decoration-red-300'
                : 'whitespace-pre-wrap text-hearth-text-muted'
          }
        >
          <span aria-hidden="true" className="mr-1 select-none">
            {l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}
          </span>
          <span className="sr-only">
            {l.type === 'add' ? 'Added: ' : l.type === 'del' ? 'Removed: ' : ''}
          </span>
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}

function VersionRow({
  item,
  previous,
  isCurrent,
  canRestore,
  noun,
  onRestore,
}: {
  item: HistoryItem;
  previous: HistoryItem | undefined;
  isCurrent: boolean;
  canRestore: boolean;
  noun: Props['noun'];
  onRestore: (version: number, overrideTests: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<RoutineTestFailure[] | null>(null);

  const lines = previous ? lineDiff(previous.text, item.text) : null;
  const who = item.changedByName ?? (item.changeSource === 'migration' ? 'Hearth' : 'Someone');

  const doRestore = async (override: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await onRestore(item.version, override);
      setConfirming(false);
      setFailures(null);
    } catch (err) {
      const f = testFailuresOf(err);
      if (f) setFailures(f);
      else setError((err as Error).message || 'Could not restore this version');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="animate-fade-in rounded-lg border border-hearth-border bg-hearth-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs font-semibold text-hearth-text">v{item.version}</span>
        {isCurrent && <HBadge tone="ok">Current</HBadge>}
        <span className="text-xs text-hearth-text-muted">
          {sourceLabel(item.changeSource)}
          {item.restoredFrom ? ` from v${item.restoredFrom}` : ''} · {who} ·{' '}
          <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>
            {when(item.createdAt)}
          </time>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded text-xs font-medium text-hearth-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-hearth-600"
        >
          {open
            ? 'Hide'
            : lines
              ? `Show changes to the ${noun} (${diffSummary(lines)})`
              : `Show the first ${noun}`}
        </button>
        {canRestore && !isCurrent && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto rounded-md border border-hearth-border-strong px-2.5 py-1 text-xs font-medium text-hearth-text hover:bg-hearth-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-hearth-600"
          >
            Restore this version
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2">
          {lines ? (
            <DiffView lines={lines} />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-hearth-bg p-2 font-mono text-xs">
              {item.text}
            </pre>
          )}
        </div>
      )}

      {confirming && (
        <div
          role="group"
          aria-label={`Restore version ${item.version}`}
          className="mt-2 rounded-md bg-hearth-bg p-2.5 text-xs text-hearth-text"
        >
          {failures ? (
            <>
              <TestFailureList failures={failures} />
              <div className="mt-2 flex flex-wrap gap-2">
                <HButton
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => doRestore(true)}
                >
                  {busy ? 'Restoring…' : 'Restore anyway'}
                </HButton>
                <HButton
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                    setFailures(null);
                  }}
                >
                  Cancel
                </HButton>
              </div>
            </>
          ) : (
            <>
              <p>Restore v{item.version}? It is saved as a new version; nothing is lost.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <HButton
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => doRestore(false)}
                  autoFocus
                >
                  {busy ? 'Restoring…' : 'Restore'}
                </HButton>
                <HButton size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </HButton>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="mt-2 text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function VersionHistory({ noun, load, restore, onRestored }: Props) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPage(await load());
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Could not load the history');
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (!page) {
    return <p className="text-sm text-hearth-text-muted">Loading history…</p>;
  }
  if (page.items.length === 0) {
    return <p className="text-sm text-hearth-text-muted">No history yet.</p>;
  }

  return (
    <div className="animate-fade-in">
      {!page.isOwner && (
        <p className="mb-2 text-xs text-hearth-text-faint">
          Only an owner can restore an older version.
        </p>
      )}
      <ol className="space-y-2" aria-label="Version history">
        {page.items.map((item, i) => (
          <VersionRow
            key={item.version}
            item={item}
            previous={page.items[i + 1]}
            isCurrent={item.version === page.currentVersion}
            canRestore={page.isOwner}
            noun={noun}
            onRestore={async (version, override) => {
              await restore(version, override);
              await refresh();
              onRestored?.();
            }}
          />
        ))}
      </ol>
      {page.total > page.items.length && (
        <p className="mt-2 text-xs text-hearth-text-faint">
          Showing the newest {page.items.length} of {page.total} versions.
        </p>
      )}
    </div>
  );
}
