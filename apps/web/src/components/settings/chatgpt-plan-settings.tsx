import { useEffect, useState } from 'react';
import { HBadge, HButton, HCard, HEyebrow } from '@/components/ui/primitives';
import { useChatGPTPlan, type ChatGPTPlanModel } from '@/hooks/use-chatgpt-plan';

/**
 * Settings → ChatGPT plan. Lets any user (signed in with Google, email or SSO)
 * connect their ChatGPT account so their chats spend their ChatGPT plan instead
 * of the org's API key. Follows OpenAI's Sign in with ChatGPT UI guidelines:
 * "Continue with ChatGPT" CTA, first-use disclosure modal, Manage usage link.
 */

const RESULT_MESSAGES: Record<string, { tone: 'ok' | 'err'; text: string }> = {
  connected: { tone: 'ok', text: 'Your ChatGPT account is connected.' },
  access_denied: { tone: 'err', text: 'ChatGPT access was not granted. Nothing was connected.' },
  plan_not_granted: {
    tone: 'err',
    text: 'You signed in, but didn’t allow Hearth to use your ChatGPT plan. Try again and allow plan usage.',
  },
  account_mismatch: {
    tone: 'err',
    text: 'That’s a different ChatGPT account from the one already connected. Disconnect it first.',
  },
  invalid_state: { tone: 'err', text: 'That sign-in link expired. Please try again.' },
};

/** Read and clear the `?chatgpt=` result the OAuth callback redirected with. */
function consumeResultParam(): string | null {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('chatgpt');
  if (result) {
    url.searchParams.delete('chatgpt');
    window.history.replaceState(null, '', url.toString());
  }
  return result;
}

export function ChatGPTPlanSettings() {
  const { status, loading, connect, update, disconnect, listModels, refresh } = useChatGPTPlan();
  const [result] = useState(consumeResultParam);
  const [models, setModels] = useState<ChatGPTPlanModel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    if (result) refresh();
  }, [result, refresh]);

  useEffect(() => {
    if (status?.connected && status.status === 'active') {
      listModels()
        .then(setModels)
        .catch(() => setModels([]));
    }
  }, [status?.connected, status?.status, listModels]);

  if (loading)
    return <div className="mx-auto max-w-2xl text-sm text-hearth-text-muted">Loading…</div>;

  const banner = result
    ? (RESULT_MESSAGES[result] ?? {
        tone: 'err' as const,
        text: 'Connecting ChatGPT failed. Please try again.',
      })
    : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {banner && (
        <div
          role="status"
          className={`rounded-md border px-4 py-3 text-sm ${
            banner.tone === 'ok'
              ? 'border-hearth-ok/40 text-hearth-ok'
              : 'border-hearth-err/40 text-hearth-err'
          }`}
        >
          {banner.text}
        </div>
      )}

      <HCard padding="p-6">
        <HEyebrow>AI usage</HEyebrow>
        <div className="mt-1 flex items-center gap-2">
          <h2 className="text-base font-semibold text-hearth-text">Use your ChatGPT plan</h2>
          {status?.connected && <ConnectionBadge status={status.status} />}
        </div>
        <p className="mt-2 text-sm text-hearth-text-muted">
          Connect your ChatGPT account and your chats in Hearth will use your ChatGPT plan instead
          of your organization&rsquo;s API key. Usage counts toward your ChatGPT plan limits; you
          can set a weekly cap for Hearth in ChatGPT.{' '}
          <a href={status?.helpUrl} target="_blank" rel="noreferrer" className="underline">
            Learn more
          </a>
        </p>

        {!status?.enabled ? (
          <p className="mt-4 rounded-md bg-hearth-chip px-3 py-2 text-sm text-hearth-text-muted">
            ChatGPT plan usage isn&rsquo;t enabled on this Hearth server. Ask your administrator to
            set <code>CHATGPT_PLAN_ENABLED=true</code>.
          </p>
        ) : !status.connected ? (
          <div className="mt-5 space-y-3">
            <ContinueWithChatGPTButton disabled={busy} onClick={() => run(connect)} />
            {status.mode === 'open_source' && (
              <p className="text-xs text-hearth-text-faint">
                ChatGPT sends you back to this Hearth server at <code>127.0.0.1</code>, so this
                works when Hearth runs on this computer.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="text-sm">
              <span className="text-hearth-text-muted">Connected as </span>
              <span className="font-medium text-hearth-text">
                {status.accountEmail ?? 'ChatGPT account'}
              </span>
            </div>

            {status.status === 'needs_reauth' && (
              <div className="flex items-center justify-between gap-3 rounded-md bg-hearth-chip px-3 py-2 text-sm">
                <span className="text-hearth-text-muted">Your ChatGPT connection expired.</span>
                <ContinueWithChatGPTButton compact disabled={busy} onClick={() => run(connect)} />
              </div>
            )}

            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium text-hearth-text">
                  Use my ChatGPT plan for my chats
                </span>
                <span className="block text-xs text-hearth-text-faint">
                  When off, your chats use your organization&rsquo;s models.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={!!status.useForChat}
                disabled={busy}
                onChange={(e) => run(() => update({ useForChat: e.target.checked }))}
              />
            </label>

            {models && models.length > 0 && (
              <label className="block">
                <span className="block text-sm font-medium text-hearth-text">Model</span>
                <select
                  className="mt-1 w-full rounded-md border border-hearth-border bg-hearth-card px-3 py-2 text-sm text-hearth-text"
                  value={status.defaultModel ?? ''}
                  disabled={busy}
                  onChange={(e) => run(() => update({ defaultModel: e.target.value || null }))}
                >
                  <option value="">Default ({models[0]!.displayName})</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-hearth-border pt-4">
              <a href={status.manageUsageUrl} target="_blank" rel="noreferrer">
                <HButton variant="secondary" size="sm" iconRight="external">
                  Manage usage
                </HButton>
              </a>
              {confirmDisconnect ? (
                <>
                  <span className="text-xs text-hearth-text-muted">Disconnect ChatGPT?</span>
                  <HButton
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await disconnect();
                        setConfirmDisconnect(false);
                      })
                    }
                  >
                    Yes, disconnect
                  </HButton>
                  <HButton variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                    Cancel
                  </HButton>
                </>
              ) : (
                <HButton variant="ghost" size="sm" onClick={() => setConfirmDisconnect(true)}>
                  Disconnect
                </HButton>
              )}
            </div>
            <p className="text-xs text-hearth-text-faint">
              Disconnecting revokes Hearth&rsquo;s access and deletes its copy of your tokens. You can
              also remove Hearth in ChatGPT under Settings → Security and login → Sign in with ChatGPT.
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-hearth-err">{error}</p>}
      </HCard>

      {status?.connected && status.status === 'active' && !status.welcomeAcknowledged && (
        <ChatGPTPlanWelcomeModal
          onAcknowledge={() => run(() => update({ acknowledgeWelcome: true }))}
          manageUsageUrl={status.manageUsageUrl}
        />
      )}
    </div>
  );
}

function ConnectionBadge({ status }: { status?: string }) {
  if (status === 'active') return <HBadge tone="ok">Connected</HBadge>;
  if (status === 'needs_reauth') return <HBadge tone="warn">Reconnect needed</HBadge>;
  return <HBadge tone="warn">Plan unavailable</HBadge>;
}

/** OpenAI's prescribed CTA copy: "Continue with ChatGPT". */
export function ContinueWithChatGPTButton({
  onClick,
  disabled,
  compact,
}: {
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-md bg-black font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${
        compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
      }`}
    >
      <ChatGPTMark className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      Continue with ChatGPT
    </button>
  );
}

/** Simple monochrome knot glyph; swap for OpenAI's approved button asset when available. */
function ChatGPTMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18" strokeLinecap="round" />
    </svg>
  );
}

/** First-use disclosure required by OpenAI's UI guidelines. Shown once. */
function ChatGPTPlanWelcomeModal({
  onAcknowledge,
  manageUsageUrl,
}: {
  onAcknowledge: () => void;
  manageUsageUrl: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chatgpt-welcome-title"
    >
      <div className="w-full max-w-md rounded-lg border border-hearth-border bg-hearth-card p-6 shadow-hearth-3">
        <h3 id="chatgpt-welcome-title" className="text-base font-semibold text-hearth-text">
          You&rsquo;re using your ChatGPT plan
        </h3>
        <p className="mt-2 text-sm text-hearth-text-muted">
          Your AI requests in Hearth now use your ChatGPT plan and count toward its usage limits.
          This is separate from any Hearth subscription or charges. You can set a usage cap for
          Hearth in{' '}
          <a href={manageUsageUrl} target="_blank" rel="noreferrer" className="underline">
            ChatGPT settings
          </a>
          .
        </p>
        <div className="mt-5 flex justify-end">
          <HButton variant="primary" onClick={onAcknowledge} autoFocus>
            Got it
          </HButton>
        </div>
      </div>
    </div>
  );
}
