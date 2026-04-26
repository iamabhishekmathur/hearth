import { useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { ApiResponse, CollaboratorRole } from '@hearth/shared';

type ContentFilter = 'all' | 'responses' | 'prompts';

interface Collaborator {
  id: string;
  userId: string;
  role: CollaboratorRole;
  user: { id: string; name: string; email: string };
}

interface OrgMember {
  id: string;
  name: string;
  email: string;
}

interface ShareDialogProps {
  sessionId: string;
  visibility: string;
  onClose: () => void;
  onVisibilityChange: (visibility: 'private' | 'org') => void;
}

export function ShareDialog({
  sessionId,
  visibility,
  onClose,
  onVisibilityChange,
}: ShareDialogProps) {
  // Link sharing state
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Team visibility toggle
  const [visToggling, setVisToggling] = useState(false);
  const isOrgVisible = visibility === 'org';

  // Collaborators
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<OrgMember[]>([]);
  const [addingRole, setAddingRole] = useState<CollaboratorRole>('viewer');

  // Load collaborators on mount
  useEffect(() => {
    api
      .get<ApiResponse<Collaborator[]>>(`/chat/sessions/${sessionId}/collaborators`)
      .then((res) => {
        if (res.data) setCollaborators(res.data);
      })
      .catch(() => {});
  }, [sessionId]);

  // Search org members
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<ApiResponse<OrgMember[]>>(`/chat/users/search?q=${encodeURIComponent(searchQuery)}`)
        .then((res) => {
          if (res.data) {
            // Filter out users who are already collaborators
            const existing = new Set(collaborators.map((c) => c.userId));
            setSearchResults(res.data.filter((u) => !existing.has(u.id)));
          }
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, collaborators]);

  const handleToggleVisibility = useCallback(async () => {
    setVisToggling(true);
    setError(null);
    try {
      const newVis = isOrgVisible ? 'private' : 'org';
      await api.patch(`/chat/sessions/${sessionId}/visibility`, { visibility: newVis });
      onVisibilityChange(newVis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visibility');
    } finally {
      setVisToggling(false);
    }
  }, [sessionId, isOrgVisible, onVisibilityChange]);

  const handleCreateLink = useCallback(async () => {
    setLinkLoading(true);
    setError(null);
    try {
      const res = await api.post<{ data: { token: string } }>(
        `/chat/sessions/${sessionId}/share`,
        { contentFilter },
      );
      const token = res.data.token;
      const link = `${window.location.origin}/#/shared/${token}`;
      setShareLink(link);
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setLinkLoading(false);
    }
  }, [sessionId, contentFilter]);

  const handleCopy = useCallback(() => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareLink]);

  const handleDuplicate = useCallback(async () => {
    try {
      await api.post(`/chat/sessions/${sessionId}/duplicate`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate session');
    }
  }, [sessionId, onClose]);

  const handleAddCollaborator = useCallback(
    async (user: OrgMember) => {
      setError(null);
      try {
        const res = await api.post<ApiResponse<Collaborator>>(
          `/chat/sessions/${sessionId}/collaborators`,
          { userId: user.id, role: addingRole },
        );
        if (res.data) {
          setCollaborators((prev) => [
            ...prev,
            { ...res.data!, user: { id: user.id, name: user.name, email: user.email } },
          ]);
        }
        setSearchQuery('');
        setSearchResults([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add collaborator');
      }
    },
    [sessionId, addingRole],
  );

  const handleRemoveCollaborator = useCallback(
    async (userId: string) => {
      setError(null);
      try {
        await api.delete(`/chat/sessions/${sessionId}/collaborators/${userId}`);
        setCollaborators((prev) => prev.filter((c) => c.userId !== userId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove collaborator');
      }
    },
    [sessionId],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl bg-hearth-card shadow-hearth-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hearth-border px-6 py-4">
          <h2 id="share-dialog-title" className="text-lg font-semibold text-hearth-text">
            Share
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-6 py-4">
          {/* Section 1: Team Sharing */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-hearth-text">Visible to your team</p>
                <p className="text-xs text-hearth-text-muted">
                  Anyone in your organization can find this in Shared Chats
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleVisibility}
                disabled={visToggling}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  isOrgVisible ? 'bg-hearth-500' : 'bg-hearth-chip'
                } ${visToggling ? 'opacity-50' : ''}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-hearth-card shadow transition-transform ${
                    isOrgVisible ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Section 2: Add People */}
          <div>
            <p className="mb-2 text-sm font-medium text-hearth-text">Add people</p>
            <div className="relative">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or email..."
                  className="flex-1 rounded-lg border border-hearth-border-strong bg-hearth-bg px-3 py-1.5 text-sm text-hearth-text placeholder-hearth-text-faint focus:border-hearth-400 focus:bg-hearth-card focus:outline-none focus:ring-2 focus:ring-hearth-100"
                />
                <select
                  value={addingRole}
                  onChange={(e) => setAddingRole(e.target.value as CollaboratorRole)}
                  className="rounded-lg border border-hearth-border-strong bg-hearth-bg px-2 py-1.5 text-xs text-hearth-text-muted"
                >
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                </select>
              </div>

              {/* Search results dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-3">
                  {searchResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => handleAddCollaborator(user)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hearth-bg"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hearth-100 text-xs font-medium text-hearth-700">
                        {user.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-hearth-text">{user.name}</p>
                        <p className="truncate text-xs text-hearth-text-muted">{user.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Collaborator list */}
            {collaborators.length > 0 && (
              <div className="mt-2 space-y-1">
                {collaborators.map((collab) => (
                  <div
                    key={collab.userId}
                    className="flex items-center gap-2 rounded-lg bg-hearth-bg px-3 py-1.5"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hearth-100 text-xs font-medium text-hearth-700">
                      {collab.user.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-hearth-text">{collab.user.name}</p>
                    </div>
                    <span className="rounded bg-hearth-chip px-1.5 py-0.5 text-[10px] text-hearth-text-muted">
                      {collab.role}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCollaborator(collab.userId)}
                      className="rounded p-0.5 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Link Sharing */}
          <div>
            <p className="mb-2 text-sm font-medium text-hearth-text">Link sharing</p>
            {!shareLink ? (
              <div className="flex items-center gap-2">
                <select
                  value={contentFilter}
                  onChange={(e) => setContentFilter(e.target.value as ContentFilter)}
                  className="rounded-lg border border-hearth-border-strong bg-hearth-bg px-3 py-2 text-sm text-hearth-text-muted"
                >
                  <option value="all">Everything</option>
                  <option value="responses">AI responses only</option>
                  <option value="prompts">Prompts only</option>
                </select>
                <button
                  type="button"
                  onClick={handleCreateLink}
                  disabled={linkLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-hearth-border-strong px-3 py-2 text-sm text-hearth-text hover:bg-hearth-bg disabled:opacity-50"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
                    <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
                  </svg>
                  {linkLoading ? 'Creating...' : 'Copy link'}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareLink}
                  className="flex-1 rounded-lg border border-hearth-border-strong bg-hearth-bg px-3 py-2 text-sm text-hearth-text"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg border border-hearth-border-strong px-3 py-2 text-sm text-hearth-text hover:bg-hearth-bg"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          {/* Section 4: Duplicate */}
          <div className="border-t border-hearth-border pt-4">
            <button
              type="button"
              onClick={handleDuplicate}
              className="flex items-center gap-1.5 text-sm text-hearth-text-muted hover:text-hearth-text"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.44A1.5 1.5 0 0 0 8.378 6H4.5Z" />
              </svg>
              Duplicate to my chats
            </button>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
