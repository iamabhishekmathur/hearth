import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FadeIn } from '@/components/ui/motion';
import { HButton, HBadge } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics-events';
import {
  createInvite,
  listInvites,
  revokeInvite,
  type Invitation,
  type InviteContextType,
} from '@/lib/invitations';

interface InviteTeammatesProps {
  /**
   * Where this surface is rendered — feeds INVITE_SENT analytics `context` and
   * lets the onboarding mount react after a successful send (to tick the step).
   */
  source: 'settings' | 'onboarding' | 'contextual';
  /**
   * Optional artifact to attach to the invite, turning it into a CONTEXTUAL
   * invite so the invitee lands directly in this thing after accepting.
   */
  context?: { type: InviteContextType; id: string; label?: string };
  /** Fired after an invite is successfully created (used to refresh onboarding). */
  onInviteSent?: (invite: Invitation) => void;
}

const CONTEXT_LABEL: Record<InviteContextType, string> = {
  decision: 'decision',
  chat_session: 'chat',
  task: 'task',
};

export function InviteTeammates({ source, context, onInviteSent }: InviteTeammatesProps) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  /** The just-created invite whose link we surface for copying. */
  const [lastInvite, setLastInvite] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const list = await listInvites();
      setInvites(list.filter((i) => i.status === 'pending'));
    } catch {
      // Listing is best-effort; the create flow still works without it.
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = email.trim();
      if (!trimmed) return;
      setSending(true);
      setError(null);
      setCopied(false);
      try {
        const invite = await createInvite({
          email: trimmed,
          context: context ? { type: context.type, id: context.id } : undefined,
        });
        trackEvent(AnalyticsEvent.INVITE_SENT, { count: 1, context: source });
        setLastInvite(invite);
        setEmail('');
        await refreshList();
        onInviteSent?.(invite);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send invite.');
      } finally {
        setSending(false);
      }
    },
    [email, context, source, refreshList, onInviteSent],
  );

  const handleCopy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be unavailable (insecure context) — the link stays visible
      // for manual copy, so this is a non-fatal best-effort.
    }
  }, []);

  const handleRevoke = useCallback(
    async (id: string) => {
      // Optimistic: drop it locally, then reconcile.
      setInvites((prev) => prev.filter((i) => i.id !== id));
      if (lastInvite?.id === id) setLastInvite(null);
      try {
        await revokeInvite(id);
      } finally {
        await refreshList();
      }
    },
    [lastInvite, refreshList],
  );

  return (
    <div className="space-y-4">
      {context && (
        <div className="flex items-center gap-2 rounded-md border border-hearth-border bg-hearth-card-alt px-3 py-2">
          <HIcon name="link" size={14} color="var(--hearth-accent)" />
          <span className="text-[12.5px] text-hearth-text-muted">
            They'll land directly in this {CONTEXT_LABEL[context.type]}
            {context.label ? <> — <span className="font-medium text-hearth-text">{context.label}</span></> : null}.
          </span>
        </div>
      )}

      {/* Invite-by-email form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-[9px] transition-all duration-fast ease-hearth focus-within:border-hearth-accent focus-within:shadow-hearth-focus">
            <HIcon name="team" size={14} color="var(--hearth-text-faint)" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1 border-none bg-transparent text-[13.5px] text-hearth-text outline-none placeholder:text-hearth-text-faint"
            />
          </div>
          {error && <p className="mt-1.5 text-[12px] text-hearth-err">{error}</p>}
        </div>
        <HButton type="submit" variant="accent" icon="send" disabled={sending}>
          {sending ? 'Sending...' : 'Send invite'}
        </HButton>
      </form>

      {/* Copyable invite link for the just-sent invite */}
      {lastInvite?.acceptUrl && (
        <FadeIn variant="fade-in">
          <div className="rounded-md border border-hearth-border bg-hearth-card-alt p-3">
            <div className="flex items-center gap-2">
              <HIcon name="check" size={14} color="var(--hearth-ok)" />
              <span className="text-[12.5px] font-medium text-hearth-text">
                Invite sent to {lastInvite.email}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-hearth-text-muted">
              Or share this link directly:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={lastInvite.acceptUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md border border-hearth-border bg-hearth-card px-2.5 py-1.5 font-mono text-[12px] text-hearth-text-muted outline-none"
              />
              <HButton
                type="button"
                variant="secondary"
                size="sm"
                icon={copied ? 'check' : 'copy'}
                onClick={() => handleCopy(lastInvite.acceptUrl!)}
              >
                {copied ? 'Copied' : 'Copy'}
              </HButton>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Pending invites list */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-hearth-text-muted">
            Pending invites
          </span>
          {!loadingList && invites.length > 0 && (
            <span className="text-[11px] text-hearth-text-faint">{invites.length}</span>
          )}
        </div>
        {loadingList ? (
          <p className="text-[12px] text-hearth-text-faint">Loading...</p>
        ) : invites.length === 0 ? (
          <p className="text-[12px] text-hearth-text-faint">
            No pending invites yet.
          </p>
        ) : (
          <ul className="divide-y divide-hearth-border rounded-md border border-hearth-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] text-hearth-text">{inv.email}</span>
                    {inv.contextType && (
                      <HBadge tone="accent">{CONTEXT_LABEL[inv.contextType]}</HBadge>
                    )}
                  </div>
                  <span className="text-[11px] text-hearth-text-faint">Pending</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(inv.id)}
                  className="rounded p-1 text-hearth-text-faint transition-colors hover:text-hearth-err"
                  aria-label={`Revoke invite for ${inv.email}`}
                >
                  <HIcon name="x" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
