import { CHATGPT_PLAN_ERROR_CODES } from '@hearth/shared';
import { HButton } from '@/components/ui/primitives';
import { useChatGPTPlan } from '@/hooks/use-chatgpt-plan';

/**
 * "Using ChatGPT plan · Manage usage" chip shown next to the composer when the
 * user's chats are routed through their ChatGPT plan (OpenAI UI guideline).
 */
export function ChatGPTPlanIndicator() {
  const { active, status } = useChatGPTPlan();
  if (!active || !status) return null;
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-hearth-border px-2.5 text-xs text-hearth-text-muted">
      <span className="font-medium text-hearth-text">Using ChatGPT plan</span>
      <span aria-hidden="true">·</span>
      <a
        href={status.manageUsageUrl}
        target="_blank"
        rel="noreferrer"
        className="underline hover:text-hearth-text"
      >
        Manage usage
      </a>
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
