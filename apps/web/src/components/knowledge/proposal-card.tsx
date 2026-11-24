import { useEffect, useRef, useState } from 'react';
import type { KnowledgeProposal } from '@hearth/shared';
import { HBadge, HButton, HEyebrow } from '@/components/ui/primitives';
import { affectsSentence, evidenceHref, targetKindLabel, whySentences } from './proposal-format';

type Mode = 'view' | 'edit' | 'reject';

export interface ApproveBody {
  after?: string;
  baseVersion?: number;
}

export interface ProposalCardProps {
  proposal: KnowledgeProposal;
  onApprove: (id: string, body: ApproveBody) => Promise<unknown>;
  onReject: (id: string, reason?: string) => Promise<unknown>;
  /** Called once the card is decided (or can no longer be decided). */
  onDone: (id: string) => void;
}

interface Conflict {
  currentVersion: number;
  currentContent: string | null;
}

function errorInfo(err: unknown): {
  status?: number;
  body?: Record<string, unknown>;
  message: string;
} {
  const e = err as { status?: number; body?: Record<string, unknown>; message?: string };
  return { status: e?.status, body: e?.body, message: e?.message ?? 'Something went wrong' };
}

function TextPanel({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: 'before' | 'after';
}) {
  return (
    <div
      className={`min-w-0 rounded-md border p-3 ${
        tone === 'after'
          ? 'border-hearth-accent bg-hearth-card'
          : 'border-hearth-border bg-hearth-card-alt'
      }`}
    >
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-hearth-text-faint">
        {label}
      </div>
      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-hearth-text">
        {text}
      </p>
    </div>
  );
}

export function ProposalCard({ proposal, onApprove, onReject, onDone }: ProposalCardProps) {
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState(proposal.after);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const headingId = `proposal-${proposal.id}-title`;

  useEffect(() => {
    if (mode === 'edit') editRef.current?.focus();
    if (mode === 'reject') reasonRef.current?.focus();
  }, [mode]);

  const why = whySentences(proposal.evidence.counts);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(proposal.id);
    } catch (err) {
      const { status, body, message } = errorInfo(err);
      if (status === 409 && body?.code === 'version_conflict') {
        setConflict({
          currentVersion: Number(body.currentVersion),
          currentContent: (body.currentContent as string | null) ?? null,
        });
      } else if (status === 409 || status === 410 || status === 404) {
        // Someone else decided it, or the item is gone: it leaves the inbox.
        setError(message);
        setTimeout(() => onDone(proposal.id), 1500);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const approve = () => {
    const edited = mode === 'edit' && draft.trim() !== proposal.after.trim();
    const body: ApproveBody = {};
    if (edited) body.after = draft.trim();
    if (conflict) body.baseVersion = conflict.currentVersion;
    return run(() => onApprove(proposal.id, body));
  };

  const reject = () => run(() => onReject(proposal.id, reason.trim() || undefined));

  const cancel = () => {
    setMode('view');
    setDraft(proposal.after);
    setReason('');
  };

  return (
    <article
      aria-labelledby={headingId}
      className="animate-fade-in rounded-lg border border-hearth-border bg-hearth-card p-4 sm:p-5"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && mode !== 'view' && !busy) {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <HEyebrow>Proposal from the curator</HEyebrow>
          <h2
            id={headingId}
            className="mt-1 break-words text-[15px] font-semibold text-hearth-text"
          >
            {proposal.targetName}
          </h2>
          <p className="mt-0.5 text-xs text-hearth-text-muted">Owner: {proposal.ownerLabel}</p>
        </div>
        <HBadge tone="accent">{targetKindLabel(proposal.targetType)}</HBadge>
      </header>

      {/* What changes */}
      <section className="mt-4" aria-label="What changes">
        <h3 className="mb-2 text-xs font-semibold text-hearth-text">What changes</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextPanel
            label={conflict ? 'Now (changed since)' : 'Before'}
            text={conflict?.currentContent ?? proposal.before}
            tone="before"
          />
          {mode === 'edit' ? (
            <label className="flex min-w-0 flex-col rounded-md border border-hearth-accent bg-hearth-card p-3">
              <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-hearth-text-faint">
                After (your edit)
              </span>
              <textarea
                ref={editRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                aria-label="Edited text"
                className="w-full resize-y rounded-sm border border-hearth-border-strong bg-hearth-card p-2 text-[13px] leading-relaxed text-hearth-text focus:border-hearth-accent focus:shadow-hearth-focus focus:outline-none"
              />
            </label>
          ) : (
            <TextPanel label="After" text={proposal.after} tone="after" />
          )}
        </div>
        {conflict && (
          <p role="status" className="mt-2 text-xs text-hearth-warn">
            This changed after the curator made the proposal. Check the text now in place, then
            approve again to apply the change on top of it.
          </p>
        )}
      </section>

      {/* Why */}
      <section className="mt-4" aria-label="Why">
        <h3 className="mb-1 text-xs font-semibold text-hearth-text">Why</h3>
        <p className="text-[13px] text-hearth-text">{proposal.reason}</p>
        {why.length > 0 && <p className="mt-1 text-xs text-hearth-text-muted">{why.join(' ')}</p>}
        {proposal.evidence.items.length > 0 && (
          <ul className="mt-2 space-y-1">
            {proposal.evidence.items.slice(0, 8).map((item, i) => {
              const href = evidenceHref(item.link);
              return (
                <li key={i} className="text-xs text-hearth-text-muted">
                  <span>{item.label}</span>
                  {item.quote && <span className="text-hearth-text"> “{item.quote}”</span>}
                  {href && (
                    <>
                      {' '}
                      <a
                        href={href}
                        className="font-medium text-hearth-accent underline-offset-2 hover:underline"
                      >
                        {item.link?.type === 'session' ? 'Open chat' : 'Open routine'}
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Who it affects */}
      <section className="mt-4" aria-label="Who it affects">
        <h3 className="mb-1 text-xs font-semibold text-hearth-text">Who it affects</h3>
        <p className="text-[13px] text-hearth-text-muted">{affectsSentence(proposal.affected)}</p>
      </section>

      {/* Reject reason */}
      {mode === 'reject' && (
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-hearth-text-muted">
            Why not? (optional — the curator reads this next time)
          </span>
          <textarea
            ref={reasonRef}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            aria-label="Reason for rejecting"
            className="w-full resize-y rounded-md border border-hearth-border-strong bg-hearth-card p-2 text-[13px] text-hearth-text focus:border-hearth-accent focus:shadow-hearth-focus focus:outline-none"
          />
        </label>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-hearth-err">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {mode === 'view' && (
          <>
            <HButton variant="accent" size="sm" icon="check" disabled={busy} onClick={approve}>
              {conflict ? 'Approve on new version' : 'Approve'}
            </HButton>
            <HButton variant="secondary" size="sm" disabled={busy} onClick={() => setMode('edit')}>
              Edit
            </HButton>
            <HButton variant="ghost" size="sm" disabled={busy} onClick={() => setMode('reject')}>
              Reject
            </HButton>
          </>
        )}
        {mode === 'edit' && (
          <>
            <HButton
              variant="accent"
              size="sm"
              icon="check"
              disabled={busy || draft.trim().length === 0}
              onClick={approve}
            >
              Save and approve
            </HButton>
            <HButton variant="ghost" size="sm" disabled={busy} onClick={cancel}>
              Cancel
            </HButton>
          </>
        )}
        {mode === 'reject' && (
          <>
            <HButton variant="primary" size="sm" disabled={busy} onClick={reject}>
              Reject proposal
            </HButton>
            <HButton variant="ghost" size="sm" disabled={busy} onClick={cancel}>
              Cancel
            </HButton>
          </>
        )}
      </div>
    </article>
  );
}
