import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface Skill {
  id: string;
  name: string;
  description: string | null;
  content: string;
  status: string;
  scope: string;
  installCount: number;
  author?: { id: string; name: string };
  createdAt: string;
}

type Panel = { type: 'detail'; skill: Skill } | null;

export function SkillGovernance() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await api.get<{ data: Skill[] }>('/skills');
      setSkills(res.data ?? []);
    } catch {
      // Skill list may not be available
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    setActionLoading(id);
    try {
      await api.patch(`/skills/${id}`, { status });
      await fetchSkills();
      // Update panel if viewing this skill
      setPanel((prev) =>
        prev?.type === 'detail' && prev.skill.id === id
          ? { type: 'detail', skill: { ...prev.skill, status } }
          : prev,
      );
    } catch {
      // Handle error
    } finally {
      setActionLoading(null);
    }
  }, [fetchSkills]);

  const handleDelete = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await api.delete(`/skills/${id}`);
      setPanel((prev) => (prev?.type === 'detail' && prev.skill.id === id ? null : prev));
      await fetchSkills();
    } catch {
      // Handle error
    } finally {
      setActionLoading(null);
    }
  }, [fetchSkills]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-hearth-600" />
      </div>
    );
  }

  const pendingSkills = skills.filter((s) => s.status === 'pending_review');
  const publishedSkills = skills.filter((s) => s.status === 'published');
  const draftSkills = skills.filter((s) => s.status === 'draft');
  const deprecatedSkills = skills.filter((s) => s.status === 'deprecated');

  return (
    <div className="flex gap-6">
      {/* Left — skill lists */}
      <div className="min-w-0 flex-1">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Skill Governance</h3>

        {/* Pending review */}
        {pendingSkills.length > 0 && (
          <Section
            title="Pending Review"
            count={pendingSkills.length}
            color="amber"
          >
            {pendingSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                selected={panel?.type === 'detail' && panel.skill.id === skill.id}
                loading={actionLoading === skill.id}
                onSelect={() => setPanel({ type: 'detail', skill })}
                actions={
                  <>
                    <ActionBtn
                      label="Approve"
                      color="green"
                      disabled={actionLoading === skill.id}
                      onClick={() => handleStatusChange(skill.id, 'published')}
                    />
                    <ActionBtn
                      label="Reject"
                      color="red"
                      disabled={actionLoading === skill.id}
                      onClick={() => handleStatusChange(skill.id, 'deprecated')}
                    />
                  </>
                }
              />
            ))}
          </Section>
        )}

        {/* Published */}
        <Section title="Published" count={publishedSkills.length} color="green">
          {publishedSkills.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-400">No published skills</p>
          ) : (
            publishedSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                selected={panel?.type === 'detail' && panel.skill.id === skill.id}
                loading={actionLoading === skill.id}
                onSelect={() => setPanel({ type: 'detail', skill })}
                actions={
                  <>
                    <ActionBtn
                      label="Deprecate"
                      color="gray"
                      disabled={actionLoading === skill.id}
                      onClick={() => handleStatusChange(skill.id, 'deprecated')}
                    />
                    <ActionBtn
                      label="Delete"
                      color="red"
                      disabled={actionLoading === skill.id}
                      onClick={() => handleDelete(skill.id)}
                    />
                  </>
                }
              />
            ))
          )}
        </Section>

        {/* Drafts */}
        {draftSkills.length > 0 && (
          <Section title="Drafts" count={draftSkills.length} color="gray">
            {draftSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                selected={panel?.type === 'detail' && panel.skill.id === skill.id}
                loading={actionLoading === skill.id}
                onSelect={() => setPanel({ type: 'detail', skill })}
                actions={
                  <ActionBtn
                    label="Delete"
                    color="red"
                    disabled={actionLoading === skill.id}
                    onClick={() => handleDelete(skill.id)}
                  />
                }
              />
            ))}
          </Section>
        )}

        {/* Deprecated */}
        {deprecatedSkills.length > 0 && (
          <Section title="Deprecated" count={deprecatedSkills.length} color="gray">
            {deprecatedSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                selected={panel?.type === 'detail' && panel.skill.id === skill.id}
                loading={actionLoading === skill.id}
                onSelect={() => setPanel({ type: 'detail', skill })}
                actions={
                  <>
                    <ActionBtn
                      label="Restore"
                      color="green"
                      disabled={actionLoading === skill.id}
                      onClick={() => handleStatusChange(skill.id, 'published')}
                    />
                    <ActionBtn
                      label="Delete"
                      color="red"
                      disabled={actionLoading === skill.id}
                      onClick={() => handleDelete(skill.id)}
                    />
                  </>
                }
              />
            ))}
          </Section>
        )}
      </div>

      {/* Right panel — skill detail */}
      {panel?.type === 'detail' && (
        <div className="w-[380px] shrink-0 rounded-lg border border-gray-200 bg-gray-50">
          <DetailPanel
            skill={panel.skill}
            onClose={() => setPanel(null)}
            onApprove={
              panel.skill.status === 'pending_review'
                ? () => handleStatusChange(panel.skill.id, 'published')
                : undefined
            }
            onReject={
              panel.skill.status === 'pending_review'
                ? () => handleStatusChange(panel.skill.id, 'deprecated')
                : undefined
            }
            onDelete={() => handleDelete(panel.skill.id)}
            loading={actionLoading === panel.skill.id}
          />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function Section({
  title,
  count,
  color,
  children,
}: {
  title: string;
  count: number;
  color: 'amber' | 'green' | 'gray';
  children: React.ReactNode;
}) {
  const colorMap = {
    amber: 'text-amber-700',
    green: 'text-green-700',
    gray: 'text-gray-700',
  };

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h4 className={`text-sm font-medium ${colorMap[color]}`}>{title}</h4>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
          {count}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SkillRow({
  skill,
  selected,
  loading,
  onSelect,
  actions,
}: {
  skill: Skill;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
  actions: React.ReactNode;
}) {
  return (
    <div
      className={`group flex items-center justify-between rounded-lg border px-4 py-2.5 transition-colors ${
        selected
          ? 'border-hearth-300 bg-hearth-50'
          : 'border-gray-100 bg-white hover:border-gray-200'
      } ${loading ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold uppercase text-gray-500">
          {skill.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-900">{skill.name}</span>
            {skill.scope !== 'personal' && (
              <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                {skill.scope}
              </span>
            )}
          </div>
          {skill.description && (
            <p className="mt-0.5 truncate text-xs text-gray-500">{skill.description}</p>
          )}
        </div>
      </button>

      <div className="ml-3 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {actions}
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: 'green' | 'red' | 'gray';
  disabled: boolean;
  onClick: () => void;
}) {
  const colorMap = {
    green: 'bg-green-600 text-white hover:bg-green-700',
    red: 'bg-red-600 text-white hover:bg-red-700',
    gray: 'bg-gray-200 text-gray-700 hover:bg-gray-300',
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${colorMap[color]}`}
    >
      {label}
    </button>
  );
}

function DetailPanel({
  skill,
  onClose,
  onApprove,
  onReject,
  onDelete,
  loading,
}: {
  skill: Skill;
  onClose: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onDelete: () => void;
  loading: boolean;
}) {
  const statusColors: Record<string, string> = {
    published: 'bg-green-100 text-green-700',
    pending_review: 'bg-amber-100 text-amber-700',
    draft: 'bg-gray-100 text-gray-600',
    deprecated: 'bg-red-100 text-red-700',
  };

  return (
    <div className="flex h-full max-h-[600px] flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-gray-900">{skill.name}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[skill.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {skill.status.replace('_', ' ')}
            </span>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
              {skill.scope}
            </span>
            <span className="text-[10px] text-gray-400">
              {skill.installCount} install{skill.installCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Description */}
      {skill.description && (
        <div className="border-b border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-600">{skill.description}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          {skill.author && (
            <div>
              <span className="text-gray-400">Author</span>
              <p className="font-medium text-gray-700">{skill.author.name}</p>
            </div>
          )}
          <div>
            <span className="text-gray-400">Created</span>
            <p className="font-medium text-gray-700">
              {new Date(skill.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Content preview */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">Content</p>
        <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-600">
          {skill.content.slice(0, 1200)}
          {skill.content.length > 1200 && '\n...'}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-3">
        {onApprove && onReject && (
          <>
            <button
              type="button"
              onClick={onApprove}
              disabled={loading}
              className="flex-1 rounded-lg bg-green-600 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={loading}
              className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={loading}
          className={`rounded-lg border border-red-200 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 ${onApprove ? 'px-3' : 'flex-1'}`}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
