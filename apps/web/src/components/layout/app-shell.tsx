import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Sidebar } from './sidebar';
import { connectSocket, onCollaboratorAdded } from '@/lib/socket-client';
import type { CollaboratorAddedEvent } from '@hearth/shared';
import { HButton } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';

interface AppShellProps {
  currentRoute: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
}

export function AppShell({ currentRoute, onNavigate, children }: AppShellProps) {
  const { user, logout } = useAuth();
  const [notification, setNotification] = useState<CollaboratorAddedEvent | null>(null);

  useEffect(() => {
    if (!user) return;
    connectSocket();
    const unsub = onCollaboratorAdded((event) => {
      setNotification(event);
      setTimeout(() => setNotification(null), 6000);
    });
    return unsub;
  }, [user]);

  const handleNotificationClick = useCallback(() => {
    if (notification) {
      onNavigate('/chat');
      setNotification(null);
    }
  }, [notification, onNavigate]);

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-hearth-bg text-hearth-text font-sans">
      <Sidebar
        user={user}
        currentRoute={currentRoute}
        onNavigate={onNavigate}
        onLogout={logout}
      />
      <main className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Collaborator added notification */}
        {notification && (
          <div className="flex items-center justify-between border-b border-hearth-border px-5 py-2" style={{ background: 'var(--hearth-accent-soft)' }}>
            <p className="text-sm text-hearth-text">
              <span className="font-semibold">{notification.addedByName}</span> added you to{' '}
              <span className="font-medium">{notification.sessionTitle ?? 'a conversation'}</span>{' '}
              as a {notification.role}
            </p>
            <div className="flex items-center gap-2">
              <HButton variant="primary" size="sm" onClick={handleNotificationClick}>Open</HButton>
              <button
                type="button"
                onClick={() => setNotification(null)}
                className="rounded p-0.5 text-hearth-text-muted hover:text-hearth-text"
              >
                <HIcon name="x" size={16} />
              </button>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
