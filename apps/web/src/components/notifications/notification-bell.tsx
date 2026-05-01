import { useState, useRef, useEffect } from 'react';
import { useNotifications } from '@/hooks/use-notifications';
import { HIcon } from '@/components/ui/icon';
import type { NotificationItem } from '@hearth/shared';

interface NotificationBellProps {
  onOpenSession?: (sessionId: string) => void;
}

export function NotificationBell({ onOpenSession }: NotificationBellProps) {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleClick = (n: NotificationItem) => {
    if (!n.readAt) void markRead(n.id);
    if (n.sessionId && onOpenSession) {
      onOpenSession(n.sessionId);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="relative rounded-md p-1.5 text-hearth-text-muted transition-colors duration-fast hover:bg-hearth-chip hover:text-hearth-text"
        title="Notifications"
        aria-label="Notifications"
      >
        <HIcon name="bell" size={16} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none"
            style={{ background: 'var(--hearth-accent)', color: 'var(--hearth-text-inverse)' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-30 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-3"
          style={{ maxHeight: 480, overflowY: 'auto' }}
        >
          <div className="flex items-center justify-between border-b border-hearth-border px-3 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-hearth-text-muted">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[11px] text-hearth-text-muted hover:text-hearth-text"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-hearth-text-faint">No notifications</div>
          ) : (
            <ul className="divide-y divide-hearth-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-hearth-bg ${
                      !n.readAt ? 'bg-hearth-50' : ''
                    }`}
                  >
                    {!n.readAt && (
                      <span
                        className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: 'var(--hearth-accent)' }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-hearth-text">{n.title}</p>
                      {n.body && <p className="truncate text-[11px] text-hearth-text-muted">{n.body}</p>}
                      <p className="mt-0.5 text-[10px] text-hearth-text-faint">{formatRelative(n.createdAt)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
