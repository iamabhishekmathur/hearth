import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RoutineDryRun, RoutineTestCase } from '@hearth/shared';
import { HBadge, HButton } from '@/components/ui/primitives';
import {
  createTestCase,
  deleteTestCase,
  fetchTestCases,
  startDryRun,
  updateTestCase,
  waitForDryRun,
} from '@/hooks/use-routine-knowledge';
import { DryRunResult } from './dry-run-result';

/**
 * Knowledge loop, Phase 4 — a routine's "Tests" tab:
 *
 *   - Dry run: run the routine (saved prompt or a draft) on its last input
 *     and compare with the last output. Nothing is sent.
 *   - Test cases: phrases the prompt must keep and the output must contain.
 *     Approved fixes add one; owners add, edit and delete their own, and
 *     "Run tests" checks them all against a dry run.
 *
 * Members and viewers see the cases and their last result, read-only.
 */

/** "a, b" ⇄ ["a", "b"] — one phrase per line in the form. */
export function parsePhrases(text: string): string[] {
  return text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
}

export function lastResultLabel(c: Pick<RoutineTestCase, 'lastStatus' | 'lastMissing'>): {
  tone: 'ok' | 'err' | 'neutral';
  text: string;
} {
  if (c.lastStatus === 'passed') return { tone: 'ok', text: 'Passed' };
  if (c.lastStatus === 'failed') return { tone: 'err', text: 'Failed' };
  return { tone: 'neutral', text: 'Not run yet' };
}

function CaseForm({
  initial,
  onSave,
  onCancel,
  submitLabel,
}: {
  initial?: { description: string; mustContain: string[] };
  onSave: (body: { description: string; mustContain: string[] }) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [description, setDescription] = useState(initial?.description ?? '');
  const [phrases, setPhrases] = useState((initial?.mustContain ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descId = useId();
  const phraseId = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = parsePhrases(phrases);
    if (!description.trim() || list.length === 0) {
      setError('Add a description and at least one phrase.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ description: description.trim(), mustContain: list });
    } catch (err) {
      setError((err as Error).message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="animate-fade-in space-y-2 rounded-lg border border-hearth-border bg-hearth-bg p-3"
    >
      <div>
        <label htmlFor={descId} className="block text-xs font-medium text-hearth-text">
          What should stay true?
        </label>
        <input
          id={descId}
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Uses the Support queue"
          className="mt-1 w-full rounded-md border border-hearth-border-strong bg-hearth-card px-2 py-1.5 text-sm text-hearth-text"
        />
      </div>
      <div>
        <label htmlFor={phraseId} className="block text-xs font-medium text-hearth-text">
          Must contain (one phrase per line)
        </label>
        <textarea
          id={phraseId}
          value={phrases}
          rows={3}
          onChange={(e) => setPhrases(e.target.value)}
          placeholder="Support queue"
          className="mt-1 w-full rounded-md border border-hearth-border-strong bg-hearth-card px-2 py-1.5 font-mono text-xs text-hearth-text"
        />
        <p className="mt-0.5 text-[11px] text-hearth-text-faint">
          The prompt must keep each phrase it has now, and a dry run’s output must contain every
          phrase.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <HButton size="sm" variant="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </HButton>
        <HButton size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </HButton>
      </div>
    </form>
  );
}

export function TestCaseList({
  cases,
  canEdit,
  onEdit,
  onDelete,
}: {
  cases: RoutineTestCase[];
  canEdit: boolean;
  onEdit: (
    c: RoutineTestCase,
    body: { description: string; mustContain: string[] },
  ) => Promise<void>;
  onDelete: (c: RoutineTestCase) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (cases.length === 0) {
    return (
      <p className="text-sm text-hearth-text-muted">
        No test cases yet. Approving a fix to this routine adds one
        {canEdit ? ', or add your own' : ''}.
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Test cases">
      {cases.map((c) => {
        const result = lastResultLabel(c);
        if (editing === c.id) {
          return (
            <li key={c.id}>
              <CaseForm
                initial={c}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  await onEdit(c, body);
                  setEditing(null);
                }}
              />
            </li>
          );
        }
        return (
          <li
            key={c.id}
            className="animate-fade-in rounded-lg border border-hearth-border bg-hearth-card p-3"
          >
            <div className="flex flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 text-sm text-hearth-text">{c.description}</p>
              <HBadge tone={result.tone}>{result.text}</HBadge>
            </div>
            <p className="mt-1 text-xs text-hearth-text-muted">
              Must contain: {c.mustContain.map((p) => `"${p}"`).join(', ')}
            </p>
            {c.lastStatus === 'failed' && c.lastMissing && c.lastMissing.length > 0 && (
              <p className="mt-0.5 text-xs text-red-600">
                Last output was missing {c.lastMissing.map((p) => `"${p}"`).join(', ')}.
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-hearth-text-faint">
              {c.source === 'proposal' ? 'From an approved fix' : 'Added by an owner'}
              {c.lastCheckedAt ? ` · checked ${new Date(c.lastCheckedAt).toLocaleString()}` : ''}
            </p>
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-2">
                {confirmDelete === c.id ? (
                  <>
                    <span className="text-xs text-hearth-text-muted">Delete this test case?</span>
                    <HButton size="sm" variant="primary" onClick={() => onDelete(c)} autoFocus>
                      Delete
                    </HButton>
                    <HButton size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </HButton>
                  </>
                ) : (
                  <>
                    <HButton size="sm" variant="ghost" onClick={() => setEditing(c.id)}>
                      Edit
                    </HButton>
                    <HButton size="sm" variant="ghost" onClick={() => setConfirmDelete(c.id)}>
                      Delete
                    </HButton>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RoutineTests({ routineId, prompt }: { routineId: string; prompt: string }) {
  const [cases, setCases] = useState<RoutineTestCase[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(prompt);
  const [run, setRun] = useState<RoutineDryRun | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const draftId = useId();

  const load = useCallback(async () => {
    try {
      const res = await fetchTestCases(routineId);
      setCases(res.cases);
      setCanEdit(res.canEdit);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message || 'Could not load test cases');
    }
  }, [routineId]);

  useEffect(() => {
    void load();
    setDraft(prompt);
    setRun(null);
    return () => abort.current?.abort();
  }, [load, prompt]);

  const go = async (tests: boolean) => {
    setStartError(null);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const usingDraft = draft.trim() && draft !== prompt;
      const started = await startDryRun(routineId, {
        tests,
        prompt: usingDraft ? draft : undefined,
      });
      setRun(started);
      const done = await waitForDryRun(routineId, started.id, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setRun(done);
      if (tests) void load();
    } catch (err) {
      setStartError((err as Error).message || 'Could not start the dry run');
    }
  };

  const running = run?.status === 'running';

  return (
    <div className="flex-1 space-y-6 overflow-y-auto p-5">
      {canEdit && (
        <section aria-labelledby={`${draftId}-h`} className="animate-fade-in space-y-2">
          <h4
            id={`${draftId}-h`}
            className="text-xs font-semibold uppercase tracking-wide text-hearth-text-faint"
          >
            Dry run
          </h4>
          <p className="text-xs text-hearth-text-muted">
            Runs the routine on its last input. Nothing is sent and nothing is saved. Edit the
            prompt below to try a change first.
          </p>
          <label htmlFor={draftId} className="sr-only">
            Prompt to try
          </label>
          <textarea
            id={draftId}
            value={draft}
            rows={5}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-md border border-hearth-border-strong bg-hearth-card px-2 py-1.5 text-sm text-hearth-text"
          />
          <div className="flex flex-wrap gap-2">
            <HButton size="sm" variant="primary" disabled={running} onClick={() => go(false)}>
              {running && run?.kind === 'dry_run' ? 'Running…' : 'Dry run'}
            </HButton>
            {cases && cases.length > 0 && (
              <HButton size="sm" disabled={running} onClick={() => go(true)}>
                {running && run?.kind === 'tests' ? 'Running tests…' : 'Run tests'}
              </HButton>
            )}
            {draft !== prompt && (
              <HButton size="sm" variant="ghost" onClick={() => setDraft(prompt)}>
                Use the saved prompt
              </HButton>
            )}
          </div>
          {startError && (
            <p role="alert" className="text-xs text-red-600">
              {startError}
            </p>
          )}
          {run && <DryRunResult run={run} />}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">
            Test cases
          </h4>
          {canEdit && !adding && (
            <HButton size="sm" variant="ghost" onClick={() => setAdding(true)}>
              Add test case
            </HButton>
          )}
        </div>
        {loadError && (
          <p role="alert" className="text-xs text-red-600">
            {loadError}
          </p>
        )}
        {adding && (
          <CaseForm
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSave={async (body) => {
              await createTestCase(routineId, body);
              setAdding(false);
              await load();
            }}
          />
        )}
        {cases ? (
          <TestCaseList
            cases={cases}
            canEdit={canEdit}
            onEdit={async (c, body) => {
              await updateTestCase(routineId, c.id, body);
              await load();
            }}
            onDelete={async (c) => {
              await deleteTestCase(routineId, c.id);
              await load();
            }}
          />
        ) : (
          !loadError && <p className="text-sm text-hearth-text-muted">Loading…</p>
        )}
      </section>
    </div>
  );
}
