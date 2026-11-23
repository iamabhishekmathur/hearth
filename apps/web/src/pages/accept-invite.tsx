import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { FadeIn } from '@/components/ui/motion';
import { HButton, HBadge, HCard } from '@/components/ui/primitives';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics-events';
import {
  getInvitePreview,
  acceptInvite,
  contextLandingHash,
  type InvitePreview,
  type InviteContextType,
} from '@/lib/invitations';

interface AcceptInvitePageProps {
  token: string;
}

const CONTEXT_VERB: Record<InviteContextType, string> = {
  decision: 'a decision',
  chat_session: 'a conversation',
  task: 'a task',
};

/**
 * PUBLIC accept-invite page at #/invite/:token (no auth).
 *
 * Flow:
 *  1. GET token preview -> "{invitedByName} invited you to {orgName}".
 *  2. Invitee sets name + password and submits.
 *  3. POST accept creates the member user AND establishes the session +
 *     CSRF cookie server-side (CSRF-exempt, like register).
 *  4. We refresh the auth context (so `user` populates) and then navigate:
 *     - contextual invite -> straight into the artifact;
 *     - plain invite -> /chat.
 *  5. Fire INVITE_ACCEPTED.
 */
export function AcceptInvitePage({ token }: AcceptInvitePageProps) {
  const { refresh } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getInvitePreview(token)
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Invitation not found.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setSubmitError(null);
      try {
        const result = await acceptInvite(token, { name: name.trim(), password });
        trackEvent(AnalyticsEvent.INVITE_ACCEPTED, { inviteId: result.user.id });
        // Session is set server-side; hydrate the auth context so the app shell
        // treats us as signed in, then land in the contextual artifact (or /chat).
        await refresh();
        window.location.hash = contextLandingHash(result.context);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Could not accept invitation.');
        setSubmitting(false);
      }
    },
    [token, name, password, refresh],
  );

  // ---- Loading -------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hearth-bg">
        <p className="text-sm text-hearth-text-faint">Loading invitation...</p>
      </div>
    );
  }

  // ---- Invalid / expired ---------------------------------------------------
  if (loadError || !preview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hearth-bg px-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-medium text-hearth-text">Invitation unavailable</h1>
          <p className="mt-2 text-sm text-hearth-text-muted">
            {loadError ?? 'This invitation is no longer valid.'}
          </p>
          <a href="#/login" className="mt-4 inline-block text-sm text-hearth-accent hover:underline">
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  // ---- Accept form ---------------------------------------------------------
  return (
    <div className="flex min-h-screen items-center justify-center bg-hearth-bg px-4">
      <FadeIn className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-md text-white font-display font-semibold"
            style={{ background: 'var(--hearth-accent-grad)', fontSize: 20, letterSpacing: -0.5 }}
          >
            H
          </div>
          <h1 className="font-display text-[28px] font-medium" style={{ letterSpacing: '-0.8px', lineHeight: 1.1 }}>
            Join {preview.orgName}<span style={{ color: 'var(--hearth-accent)' }}>.</span>
          </h1>
          <p className="mt-2 text-sm text-hearth-text-muted">
            <span className="font-medium text-hearth-text">{preview.invitedByName}</span> invited you to{' '}
            <span className="font-medium text-hearth-text">{preview.orgName}</span> on Hearth.
          </p>
          {preview.context && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <HBadge tone="accent">Contextual invite</HBadge>
              <span className="text-[12px] text-hearth-text-muted">
                You'll land in {CONTEXT_VERB[preview.context.type]}
                {preview.context.label ? `: ${preview.context.label}` : ''}.
              </span>
            </div>
          )}
        </div>

        <HCard className="p-6 shadow-hearth-1">
          <form onSubmit={handleSubmit} className="space-y-5">
            {submitError && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>
            )}

            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-hearth-text">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                readOnly
                value={preview.email}
                className="mt-1 block w-full cursor-not-allowed rounded-lg border border-hearth-border bg-hearth-card-alt px-3 py-2 text-sm text-hearth-text-muted outline-none"
              />
            </div>

            <div>
              <label htmlFor="invite-name" className="block text-sm font-medium text-hearth-text">
                Your name
              </label>
              <input
                id="invite-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mt-1 block w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm shadow-hearth-1 outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100"
              />
            </div>

            <div>
              <label htmlFor="invite-password" className="block text-sm font-medium text-hearth-text">
                Password
              </label>
              <input
                id="invite-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="mt-1 block w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm shadow-hearth-1 outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100"
              />
            </div>

            <HButton type="submit" variant="accent" full disabled={submitting}>
              {submitting ? 'Joining...' : `Join ${preview.orgName}`}
            </HButton>
          </form>
        </HCard>
      </FadeIn>
    </div>
  );
}
