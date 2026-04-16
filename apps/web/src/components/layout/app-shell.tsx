import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Sidebar } from './sidebar';
import { connectSocket, onCollaboratorAdded } from '@/lib/socket-client';
import type { CollaboratorAddedEvent } from '@hearth/shared';

interface AppShellProps {
  currentRoute: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
}

export function AppShell({ currentRoute, onNavigate, children }: AppShellProps) {
  const { user, logout } = useAuth();
  const [notification, setNotification] = useState<CollaboratorAddedEvent | null>(null);

  // Listen for collaborator-added notifications
  useEffect(() => {
    if (!user) return;
    connectSocket();
    const unsub = onCollaboratorAdded((event) => {
      setNotification(event);
      // Auto-dismiss after 6 seconds
      setTimeout(() => setNotification(null), 6000);
    });
    return unsub;
  }, [user]);

  const handleNotificationClick = useCallback(() => {
    if (notification) {
      onNavigate(`/chat`);
      setNotification(null);
    }
  }, [notification, onNavigate]);

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        user={user}
        currentRoute={currentRoute}
        onNavigate={onNavigate}
        onLogout={logout}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Collaborator added notification */}
        {notification && (
          <div className="flex items-center justify-between border-b border-hearth-200 bg-hearth-50 px-4 py-2">
            <p className="text-sm text-hearth-800">
              <span className="font-medium">{notification.addedByName}</span> added you to{' '}
              <span className="font-medium">
                {notification.sessionTitle ?? 'a conversation'}
              </span>{' '}
              as a {notification.role}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleNotificationClick}
                className="rounded bg-hearth-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-hearth-700"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setNotification(null)}
                className="rounded p-0.5 text-hearth-400 hover:text-hearth-600"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
