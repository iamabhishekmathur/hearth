import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api-client';
import { SkillRow } from '@/components/skills/skill-card';
import { SkillPanel } from '@/components/skills/skill-detail';
import { CreateSkillPanel } from '@/components/skills/create-skill-dialog';
import { ImportSkillPanel } from '@/components/skills/import-skill-dialog';
import type { ApiResponse } from '@hearth/shared';

interface Skill {
  id: string;
  name: string;
  description: string | null;
  content: string;
  installCount: number;
  status: string;
  scope?: string;
  author?: { id: string; name: string };
}

interface SkillRecommendation {
  skillId: string;
  name: string;
  description: string | null;
  score: number;
  reasons: string[];
}

type Tab = 'all' | 'installed' | 'recommended';
type Panel = { type: 'detail'; skill: Skill } | { type: 'create' } | { type: 'import' } | null;

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [recommendations, setRecommendations] = useState<SkillRecommendation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const [allRes, installedRes] = await Promise.all([
        api.get<{ data: Skill[] }>('/skills'),
        api.get<{ data: { id: string; skillId?: string }[] }>('/skills/installed'),
      ]);
      const fetched = allRes.data || [];
      setSkills(fetched);
      setInstalledIds(new Set((installedRes.data || []).map((s) => s.id)));

      // Auto-seed built-in skills if DB is empty
      if (fetched.length === 0) {
        try {
          await api.post('/skills/seed');
          const refreshed = await api.get<{ data: Skill[] }>('/skills');
          if (refreshed.data) setSkills(refreshed.data);
        } catch {
          // Seeding failed
        }
      }

      // Fetch recommendations (non-blocking)
      api
        .get<ApiResponse<SkillRecommendation[]>>('/recommendations/skills')
        .then((res) => {
          if (res.data) setRecommendations(res.data);
        })
        .catch(() => {});
    } catch {
      // Skills may not be available
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  // Auto-select skill from URL query param (e.g., ?skillId=abc)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const skillId = params.get('skillId');
    if (skillId && skills.length > 0) {
      const skill = skills.find((s) => s.id === skillId);
      if (skill) setPanel({ type: 'detail', skill });
    }
  }, [skills]);

  const handleInstall = useCallback(async (id: string) => {
    try {
      await api.post(`/skills/${id}/install`);
      setInstalledIds((prev) => new Set([...prev, id]));
      setSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, installCount: s.installCount + 1 } : s)),
      );
      // Update panel if viewing this skill
      setPanel((prev) =>
        prev?.type === 'detail' && prev.skill.id === id
          ? { type: 'detail', skill: { ...prev.skill, installCount: prev.skill.installCount + 1 } }
          : prev,
      );
    } catch {
      // Handle error
    }
  }, []);

  const handleUninstall = useCallback(async (id: string) => {
    try {
      await api.delete(`/skills/${id}/install`);
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, installCount: Math.max(0, s.installCount - 1) } : s)),
      );
      setPanel((prev) =>
        prev?.type === 'detail' && prev.skill.id === id
          ? { type: 'detail', skill: { ...prev.skill, installCount: Math.max(0, prev.skill.installCount - 1) } }
          : prev,
      );
    } catch {
      // Handle error
    }
  }, []);

  const handlePanelCreated = useCallback(() => {
    setPanel(null);
    fetchSkills();
  }, [fetchSkills]);

  // Filtered skill lists
  const recommendedSkillIds = useMemo(
    () => new Set(recommendations.map((r) => r.skillId)),
    [recommendations],
  );

  const filteredSkills = useMemo(() => {
    let list = skills;

    if (tab === 'installed') {
      list = list.filter((s) => installedIds.has(s.id));
    } else if (tab === 'recommended') {
      list = list.filter((s) => recommendedSkillIds.has(s.id));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q),
      );
    }

    return list;
  }, [skills, tab, installedIds, recommendedSkillIds, searchQuery]);

  // Counts
  const allCount = skills.length;
  const installedCount = skills.filter((s) => installedIds.has(s.id)).length;
  const recommendedCount = skills.filter((s) => recommendedSkillIds.has(s.id)).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Skills</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Install skills to shape how your AI assistant works
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPanel({ type: 'import' })}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Import from GitHub
          </button>
          <button
            type="button"
            onClick={() => setPanel({ type: 'create' })}
            className="rounded-lg bg-hearth-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-hearth-700"
          >
            Create Skill
          </button>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center gap-4 border-b border-gray-200 px-6">
        <Tab label="All" count={allCount} active={tab === 'all'} onClick={() => setTab('all')} />
        <Tab
          label="Installed"
          count={installedCount}
          active={tab === 'installed'}
          onClick={() => setTab('installed')}
        />
        <Tab
          label="Recommended"
          count={recommendedCount}
          active={tab === 'recommended'}
          onClick={() => setTab('recommended')}
        />

        <div className="ml-auto py-2">
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          />
        </div>
      </div>

      {/* Content — list + panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Skill list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-hearth-600" />
                <p className="mt-2 text-sm text-gray-400">Loading skills...</p>
              </div>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-400">
              {searchQuery
                ? 'No skills match your search'
                : tab === 'installed'
                  ? 'No skills installed yet'
                  : tab === 'recommended'
                    ? 'No recommendations available'
                    : 'No skills available'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredSkills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  installed={installedIds.has(skill.id)}
                  recommended={recommendedSkillIds.has(skill.id)}
                  selected={panel?.type === 'detail' && panel.skill.id === skill.id}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onSelect={() => setPanel({ type: 'detail', skill })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right panel */}
        {panel && (
          <div className="w-[420px] shrink-0 border-l border-gray-200 bg-white">
            {panel.type === 'detail' && (
              <SkillPanel
                skill={panel.skill}
                installed={installedIds.has(panel.skill.id)}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                onClose={() => setPanel(null)}
              />
            )}
            {panel.type === 'create' && (
              <CreateSkillPanel
                onClose={() => setPanel(null)}
                onCreated={handlePanelCreated}
              />
            )}
            {panel.type === 'import' && (
              <ImportSkillPanel
                onClose={() => setPanel(null)}
                onImported={handlePanelCreated}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 py-3 text-sm font-medium transition-colors ${
        active ? 'text-hearth-700' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] ${
          active ? 'bg-hearth-100 text-hearth-700' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {count}
      </span>
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-hearth-600" />
      )}
    </button>
  );
}
