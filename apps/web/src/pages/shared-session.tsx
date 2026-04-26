import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface SharedMessage {
  id: string;
  role: string;
  content: string;
  createdBy?: string | null;
  createdAt: string;
}

interface SharedSessionData {
  id: string;
  shareType: string;
  contentFilterLabel?: string;
  session: {
    id: string;
    title: string | null;
    createdAt: string;
    ownerName?: string;
  };
  messages: SharedMessage[];
}

interface SharedSessionPageProps {
  token: string;
  isAuthenticated?: boolean;
}

export function SharedSessionPage({ token, isAuthenticated }: SharedSessionPageProps) {
  const [data, setData] = useState<SharedSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
    fetch(`${baseUrl}/shared/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          setError('Shared session not found or expired');
          return;
        }
        const json = await res.json();
        setData(json.data);
      })
      .catch(() => setError('Failed to load shared session'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDuplicate = useCallback(async () => {
    if (!data) return;
    setDuplicating(true);
    try {
      await api.post(`/chat/sessions/${data.session.id}/duplicate`);
      window.location.hash = '#/chat';
    } catch {
      setError('Failed to duplicate session. Please sign in first.');
    } finally {
      setDuplicating(false);
    }
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hearth-bg">
        <p className="text-sm text-hearth-text-faint">Loading shared session...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hearth-bg">
        <div className="text-center">
          <h1 className="text-xl font-bold text-hearth-text">Not Found</h1>
          <p className="mt-2 text-sm text-hearth-text-muted">{error ?? 'Session not available'}</p>
          <a href="/" className="mt-4 inline-block text-sm text-hearth-accent hover:underline">
            Go to Hearth
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-hearth-bg">
      {/* Sign-in banner for unauthenticated viewers */}
      {!isAuthenticated && (
        <div className="border-b border-hearth-200 bg-hearth-50 px-6 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <p className="text-sm text-hearth-700">
              Sign in to Hearth to duplicate this chat or collaborate in real time.
            </p>
            <a
              href="/#/login"
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-white"
              style={{ background: 'var(--hearth-accent)' }}
            >
              Sign in
            </a>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-hearth-border bg-hearth-card px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-hearth-accent">Hearth</span>
            <span className="text-sm text-hearth-text-faint">Shared Session</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold text-hearth-text">
            {data.session.title ?? 'Untitled Session'}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-hearth-text-muted">
            {data.session.ownerName && (
              <span>Shared by {data.session.ownerName}</span>
            )}
            <span>{new Date(data.session.createdAt).toLocaleDateString()}</span>
            {data.contentFilterLabel && data.shareType !== 'full' && (
              <span className="rounded bg-hearth-chip px-1.5 py-0.5">
                Showing: {data.contentFilterLabel}
              </span>
            )}
          </div>

          {/* Actions for authenticated viewers */}
          {isAuthenticated && (
            <div className="mt-3">
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={duplicating}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm text-hearth-text hover:bg-hearth-chip disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                  <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.44A1.5 1.5 0 0 0 8.378 6H4.5Z" />
                </svg>
                {duplicating ? 'Duplicating...' : 'Duplicate to my chats'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="space-y-4">
          {data.messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-lg p-4 ${
                msg.role === 'user'
                  ? 'bg-hearth-50 ring-1 ring-hearth-100'
                  : msg.role === 'assistant'
                    ? 'bg-hearth-card ring-1 ring-hearth-border'
                    : 'bg-hearth-bg'
              }`}
            >
              <div className="mb-1 text-xs font-medium text-hearth-text-muted">
                {msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Hearth' : msg.role}
              </div>
              <div className="whitespace-pre-wrap text-sm text-hearth-text">{msg.content}</div>
            </div>
          ))}
        </div>

        {data.messages.length === 0 && (
          <p className="text-center text-sm text-hearth-text-faint">No messages in this shared view</p>
        )}
      </div>
    </div>
  );
}
