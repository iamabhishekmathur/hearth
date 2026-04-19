import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useIdentity } from '@/hooks/use-identity';
import { UserManagement } from '@/components/admin/user-management';
import { TeamManagement } from '@/components/admin/team-management';
import { IntegrationHealth } from '@/components/admin/integration-health';
import { LlmConfig } from '@/components/admin/llm-config';
import { UsageAnalytics } from '@/components/admin/usage-analytics';
import { SkillGovernance } from '@/components/admin/skill-governance';
import { ComplianceConfig } from '@/components/admin/compliance-config';
import { GovernanceConfig } from '@/components/admin/governance-config';
import { CognitiveConfig } from '@/components/admin/cognitive-config';
import { api } from '@/lib/api-client';

type Tab = 'profile' | 'identity' | 'users' | 'teams' | 'integrations' | 'llm' | 'compliance' | 'analytics' | 'skills' | 'governance' | 'cognitive' | 'decisions';

const VALID_TABS = new Set<Tab>(['profile', 'identity', 'users', 'teams', 'integrations', 'llm', 'compliance', 'analytics', 'skills', 'governance', 'cognitive', 'decisions']);

const ALL_USER_TABS: { value: Tab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'identity', label: 'Soul & Identity' },
];

const ADMIN_TABS: { value: Tab; label: string }[] = [
  ...ALL_USER_TABS,
  { value: 'users', label: 'Users' },
  { value: 'teams', label: 'Teams' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'llm', label: 'LLM Config' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'skills', label: 'Skills' },
  { value: 'governance', label: 'Governance' },
  { value: 'cognitive', label: 'Digital Co-Worker' },
  { value: 'decisions', label: 'Decision Graph' },
];

function IdentityEditor() {
  const { user } = useAuth();
  const { loading, getIdentity, saveIdentity } = useIdentity();
  const [activeDoc, setActiveDoc] = useState<'org-soul' | 'user-soul' | 'user-identity'>('user-soul');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(false);

  const docConfig = {
    'org-soul': { level: 'org' as const, fileType: 'soul' as const, label: 'Org SOUL.md', adminOnly: true },
    'user-soul': { level: 'user' as const, fileType: 'soul' as const, label: 'My SOUL.md', adminOnly: false },
    'user-identity': { level: 'user' as const, fileType: 'identity' as const, label: 'My IDENTITY.md', adminOnly: false },
  };

  useEffect(() => {
    const cfg = docConfig[activeDoc];
    getIdentity(cfg.level, cfg.fileType).then((doc) => {
      setContent(doc?.content ?? '');
    });
  }, [activeDoc, getIdentity]);

  const handleSave = useCallback(async () => {
    const cfg = docConfig[activeDoc];
    await saveIdentity(cfg.level, cfg.fileType, content);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [activeDoc, content, saveIdentity]);

  const isAdmin = user?.role === 'admin';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h2 className="mb-1 text-base font-semibold text-gray-900">Soul &amp; Identity</h2>
        <p className="mb-4 text-sm text-gray-500">
          Define your AI assistant's personality, values, and working style.
        </p>

        {/* Doc selector */}
        <div className="mb-4 flex gap-1">
          {Object.entries(docConfig).map(([key, cfg]) => {
            if (cfg.adminOnly && !isAdmin) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveDoc(key as typeof activeDoc)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeDoc === key
                    ? 'bg-hearth-100 text-hearth-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Editor */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Write your ${docConfig[activeDoc].label} content here...`}
          rows={16}
          className="w-full rounded-lg border border-gray-300 p-3 font-mono text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
        />

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
          {saved && <span className="text-xs text-green-600">Saved!</span>}
        </div>
      </div>
    </div>
  );
}

function CognitiveOptOut() {
  const [status, setStatus] = useState<{ orgEnabled: boolean; userEnabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ data: { orgEnabled: boolean; userEnabled: boolean } }>('/chat/cognitive-profile/status')
      .then((res) => setStatus(res.data))
      .catch(() => {});
  }, []);

  if (!status || !status.orgEnabled) return null;

  const handleToggle = async () => {
    setSaving(true);
    try {
      await api.put('/chat/cognitive-profile/status', { enabled: !status.userEnabled });
      setStatus({ ...status, userEnabled: !status.userEnabled });
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h2 className="text-base font-semibold text-gray-900">Digital Co-Worker</h2>
      <p className="mt-1 text-sm text-gray-500">
        Your organization has cognitive profiles enabled. Hearth learns how you think from
        your conversations so coworkers can ask "How would you approach X?"
      </p>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div>
          <p className="text-sm font-medium text-gray-900">
            Allow cognitive profile for my account
          </p>
          <p className="text-xs text-gray-500">
            When disabled, no new patterns are extracted and your profile is hidden from queries.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.userEnabled}
          disabled={saving}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
            status.userEnabled ? 'bg-hearth-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              status.userEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

interface SettingsPageProps {
  initialTab?: string;
}

export function SettingsPage({ initialTab }: SettingsPageProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState<Tab>(
    VALID_TABS.has(initialTab as Tab) ? (initialTab as Tab) : 'profile',
  );

  const tabs = isAdmin ? ADMIN_TABS : ALL_USER_TABS;

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    window.location.hash = `/settings/${tab}`;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">
          {isAdmin ? 'Admin Dashboard' : 'Settings'}
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {isAdmin ? 'Manage your organization, users, and integrations.' : 'Manage your account and preferences.'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleTabChange(tab.value)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? 'border-hearth-600 text-hearth-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'profile' && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Profile</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Name</label>
                  <p className="mt-1 text-sm text-gray-900">{user?.name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Email</label>
                  <p className="mt-1 text-sm text-gray-900">{user?.email}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Role</label>
                  <p className="mt-1 text-sm capitalize text-gray-900">{user?.role}</p>
                </div>
              </div>
            </div>
            <CognitiveOptOut />
          </div>
        )}

        {activeTab === 'identity' && <IdentityEditor />}

        {activeTab === 'users' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <UserManagement />
          </div>
        )}

        {activeTab === 'teams' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <TeamManagement />
          </div>
        )}

        {activeTab === 'integrations' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <IntegrationHealth />
          </div>
        )}

        {activeTab === 'llm' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <LlmConfig />
          </div>
        )}

        {activeTab === 'compliance' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <ComplianceConfig />
          </div>
        )}

        {activeTab === 'analytics' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <UsageAnalytics />
          </div>
        )}

        {activeTab === 'skills' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <SkillGovernance />
          </div>
        )}

        {activeTab === 'governance' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <GovernanceConfig />
          </div>
        )}

        {activeTab === 'cognitive' && isAdmin && (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <CognitiveConfig />
          </div>
        )}

        {activeTab === 'decisions' && isAdmin && (
          <div className="mx-auto max-w-2xl">
            <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Decision Graph Settings</h2>
              <p className="mt-1 text-sm text-gray-500">
                Configure how decisions are automatically captured and processed.
              </p>
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Auto-extract from chat</p>
                    <p className="text-xs text-gray-500">Automatically detect and capture decisions from conversations</p>
                  </div>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Enabled</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Pattern synthesis</p>
                    <p className="text-xs text-gray-500">Nightly extraction of decision patterns and principles</p>
                  </div>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Enabled</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Meeting ingestion</p>
                    <p className="text-xs text-gray-500">Process meeting transcripts for decision extraction</p>
                  </div>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Enabled</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
