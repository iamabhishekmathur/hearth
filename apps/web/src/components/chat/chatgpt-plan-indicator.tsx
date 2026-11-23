import { CHATGPT_PLAN_ERROR_CODES } from '@hearth/shared';
import { useEffect, useState } from 'react';
import { HButton } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';
import { useChatGPTPlan, type ChatGPTPlanModel } from '@/hooks/use-chatgpt-plan';

/**
 * Composer control shown while the user's chats run on their ChatGPT plan.
 * Names the model and the plan ("GPT-6.2-Sol · ChatGPT plan"), and opens a menu
 * to switch between the plan's models, reach Manage usage (OpenAI UI
 * guideline), or go back to the organization's models.
 */
export function ChatGPTPlanIndicator({ disabled }: { disabled?: boolean }) {
  const { active, status, listModels, update } = useChatGPTPlan();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ChatGPTPlanModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || status?.status !== 'active') return;
    let cancelled = false;
    listModels()
      .then((m) => !cancelled && setModels(m))
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [active, status?.status, listModels]);

  if (!active || !status) return null;

  const selectedId = status.defaultModel ?? models?.[0]?.id ?? null;
  const selected = models?.find((m) => m.id === selectedId);
  const label = selected?.displayName ?? status.defaultModel ?? 'ChatGPT';

  const choose = async (patch: { defaultModel?: string; useForChat?: boolean }) => {
    setError(null);
    try {
      await update(patch);
      setOpen(false);
    } catch {
      setError('Couldn’t save that. Try again.');
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Model · runs on your ChatGPT plan"
        className="flex h-10 max-w-[240px] items-center gap-1.5 rounded-xl border border-hearth-border px-2.5 text-xs transition-colors hover:bg-hearth-chip disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="truncate font-medium text-hearth-text">{label}</span>
        <span aria-hidden="true" className="text-hearth-text-faint">
          ·
        </span>
        <span className="shrink-0 text-hearth-text-muted">ChatGPT plan</span>
        <svg className="h-3 w-3 shrink-0 text-hearth-text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute bottom-12 left-0 z-20 w-72 rounded-lg border border-hearth-border bg-hearth-card py-1 shadow-hearth-3 animate-fade-in">
            <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-hearth-text-faint">
              Your ChatGPT plan
            </p>
            <div role="listbox" aria-label="ChatGPT plan model" className="max-h-64 overflow-y-auto">
              {models === null ? (
                <p className="px-3 py-2 text-xs text-hearth-text-faint">Loading models…</p>
              ) : models.length === 0 ? (
                <p className="px-3 py-2 text-xs text-hearth-text-faint">
                  Couldn’t load your plan’s models. Your default model is still used.
                </p>
              ) : (
                models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={m.id === selectedId}
                    onClick={() => void choose({ defaultModel: m.id })}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                      m.id === selectedId
                        ? 'bg-hearth-chip font-medium text-hearth-text'
                        : 'text-hearth-text hover:bg-hearth-bg'
                    }`}
                  >
                    <span className="truncate">{m.displayName}</span>
                    {m.id === selectedId && <HIcon name="check" size={13} />}
                  </button>
                ))
              )}
            </div>
            <div className="mt-1 border-t border-hearth-border pt-1">
              <a
                href={status.manageUsageUrl}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-hearth-text hover:bg-hearth-bg"
              >
                Manage usage
                <HIcon name="external" size={13} />
              </a>
              <button
                type="button"
                onClick={() => void choose({ useForChat: false })}
                className="flex w-full px-3 py-2 text-left text-sm text-hearth-text-muted hover:bg-hearth-bg"
              >
                Use my organization’s models instead
              </button>
            </div>
            {error && <p className="px-3 pb-2 text-xs text-hearth-err">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}

const PLAN_CODES = new Set<string>(Object.values(CHATGPT_PLAN_ERROR_CODES));

export function isChatGPTPlanErrorCode(code: string | null | undefined): boolean {
  return !!code && PLAN_CODES.has(code);
}

/**
 * Actionable notice for ChatGPT plan errors. On a usage limit, "Manage usage"
 * is the primary action and Hearth does NOT silently switch to the org's key;
 * the user can explicitly opt to use the org's models instead.
 */
export function ChatGPTPlanErrorNotice({
  code,
  message,
  onDismiss,
}: {
  code: string;
  message: string;
  onDismiss?: () => void;
}) {
  const { status, update } = useChatGPTPlan();
  const manageUsageUrl = status?.manageUsageUrl ?? 'https://chatgpt.com/#settings/Security';
  const isLimit = code === CHATGPT_PLAN_ERROR_CODES.usageLimit;
  const needsConnect =
    code === CHATGPT_PLAN_ERROR_CODES.reauth || code === CHATGPT_PLAN_ERROR_CODES.notConnected;

  return (
    <div
      role="alert"
      className="rounded-lg border border-hearth-border bg-hearth-card px-4 py-3 text-sm shadow-hearth-1 animate-fade-in"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-hearth-text">
            {isLimit
              ? 'ChatGPT usage limit reached'
              : needsConnect
                ? 'Reconnect ChatGPT'
                : 'ChatGPT plan unavailable'}
          </p>
          <p className="mt-0.5 text-hearth-text-muted">
            {message}
            {isLimit &&
              ' The limit may be your plan’s overall limit or the cap you set for Hearth.'}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-hearth-text-faint hover:text-hearth-text"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {needsConnect ? (
          <a href="#/settings/ai-plan">
            <HButton variant="primary" size="sm">
              Reconnect ChatGPT
            </HButton>
          </a>
        ) : (
          <a href={manageUsageUrl} target="_blank" rel="noreferrer">
            <HButton variant="primary" size="sm" iconRight="external">
              Manage usage
            </HButton>
          </a>
        )}
        <HButton
          variant="ghost"
          size="sm"
          onClick={() => {
            void update({ useForChat: false });
            onDismiss?.();
          }}
        >
          Use my organization&rsquo;s models instead
        </HButton>
      </div>
    </div>
  );
}
