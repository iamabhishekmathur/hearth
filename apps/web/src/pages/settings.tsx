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
import { HButton, HCard, HEyebrow } from '@/components/ui/primitives';

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
      <HCard padding="p-6">
        <HEyebrow>Identity</HEyebrow>
        <h2 className="mt-1 text-base font-semibold text-hearth-text">Soul &amp; Identity</h2>
        <p className="mb-4 text-sm text-hearth-text-muted">
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
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all duration-fast ease-hearth ${
                  activeDoc === key
                    ? 'bg-hearth-chip text-hearth-text'
                    : 'text-hearth-text-muted hover:bg-hearth-chip'
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
          className="w-full rounded-lg border border-hearth-border-strong bg-hearth-card p-3 font-mono text-sm text-hearth-text placeholder:text-hearth-text-faint focus:outline-none"
          style={{ boxShadow: 'none' }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--hearth-accent)';
            e.currentTarget.style.boxShadow = 'var(--hearth-shadow-focus, 0 0 0 2px color-mix(in srgb, var(--hearth-accent) 25%, transparent))';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />

        <div className="mt-3 flex items-center gap-2">
          <HButton
            variant="primary"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save'}
          </HButton>
          {saved && <span className="text-xs" style={{ color: 'var(--hearth-ok)' }}>Saved!</span>}
        </div>
      </HCard>
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
    <HCard padding="p-6">
      <HEyebrow>Privacy</HEyebrow>
      <h2 className="mt-1 text-base font-semibold text-hearth-text">Digital Co-Worker</h2>
      <p className="mt-1 text-sm text-hearth-text-muted">
        Your organization has cognitive profiles enabled. Hearth learns how you think from
        your conversations so coworkers can ask "How would you approach X?"
      </p>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-hearth-border bg-hearth-card-alt p-3">
        <div>
          <p className="text-sm font-medium text-hearth-text">
            Allow cognitive profile for my account
          </p>
          <p className="text-xs text-hearth-text-muted">
            When disabled, no new patterns are extracted and your profile is hidden from queries.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.userEnabled}
          disabled={saving}
          onClick={handleToggle}
          className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50"
          style={{
            background: status.userEnabled ? 'var(--hearth-accent)' : 'var(--hearth-border-strong)',
          }}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              status.userEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </HCard>
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
      <div className="border-b border-hearth-border px-6 py-4">
        <h1 className="font-display text-2xl font-medium text-hearth-text" style={{ letterSpacing: '-0.5px' }}>
          {isAdmin ? 'Admin Dashboard' : 'Settings'}<span style={{ color: 'var(--hearth-accent)' }}>.</span>
        </h1>
        <p className="mt-0.5 text-sm text-hearth-text-muted">
          {isAdmin ? 'Manage your organization, users, and integrations.' : 'Manage your account and preferences.'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-hearth-border px-6">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleTabChange(tab.value)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-all duration-fast ease-hearth ${
              activeTab === tab.value
                ? 'text-hearth-text'
                : 'border-transparent text-hearth-text-faint hover:text-hearth-text-muted'
            }`}
            style={activeTab === tab.value ? { borderBottomColor: 'var(--hearth-accent)' } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'profile' && (
          <div className="mx-auto max-w-2xl space-y-4">
            <HCard padding="p-6">
              <HEyebrow>Account</HEyebrow>
              <h2 className="mt-1 text-base font-semibold text-hearth-text">Profile</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-hearth-text-muted">Name</label>
                  <p className="mt-1 text-sm text-hearth-text">{user?.name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-hearth-text-muted">Email</label>
                  <p className="mt-1 text-sm text-hearth-text">{user?.email}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-hearth-text-muted">Role</label>
                  <p className="mt-1 text-sm capitalize text-hearth-text">{user?.role}</p>
                </div>
              </div>
            </HCard>
            <CognitiveOptOut />
          </div>
        )}

        {activeTab === 'identity' && <IdentityEditor />}

        {activeTab === 'users' && isAdmin && (
          <HCard padding="p-6">
            <UserManagement />
          </HCard>
        )}

        {activeTab === 'teams' && isAdmin && (
          <HCard padding="p-6">
            <TeamManagement />
          </HCard>
        )}

        {activeTab === 'integrations' && isAdmin && (
          <HCard padding="p-6">
            <IntegrationHealth />
          </HCard>
        )}

        {activeTab === 'llm' && isAdmin && (
          <HCard padding="p-6">
            <LlmConfig />
          </HCard>
        )}

        {activeTab === 'compliance' && isAdmin && (
          <HCard padding="p-6">
            <ComplianceConfig />
          </HCard>
        )}

        {activeTab === 'analytics' && isAdmin && (
          <HCard padding="p-6">
            <UsageAnalytics />
          </HCard>
        )}

        {activeTab === 'skills' && isAdmin && (
          <HCard padding="p-6">
            <SkillGovernance />
          </HCard>
        )}

        {activeTab === 'governance' && isAdmin && (
          <HCard padding="p-6">
            <GovernanceConfig />
          </HCard>
        )}

        {activeTab === 'cognitive' && isAdmin && (
          <HCard padding="p-6">
            <CognitiveConfig />
          </HCard>
        )}

        {activeTab === 'decisions' && isAdmin && (
          <div className="mx-auto max-w-2xl">
            <HCard padding="p-6">
              <HEyebrow>Intelligence</HEyebrow>
              <h2 className="mt-1 text-base font-semibold text-hearth-text">Decision Graph Settings</h2>
              <p className="mt-1 text-sm text-hearth-text-muted">
                Configure how decisions are automatically captured and processed.
              </p>
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-hearth-border bg-hearth-card-alt p-3">
                  <div>
                    <p className="text-sm font-medium text-hearth-text">Auto-extract from chat</p>
                    <p className="text-xs text-hearth-text-muted">Automatically detect and capture decisions from conversations</p>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ background: 'color-mix(in srgb, var(--hearth-ok) 14%, transparent)', color: 'var(--hearth-ok)' }}
                  >
                    Enabled
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-hearth-border bg-hearth-card-alt p-3">
                  <div>
                    <p className="text-sm font-medium text-hearth-text">Pattern synthesis</p>
                    <p className="text-xs text-hearth-text-muted">Nightly extraction of decision patterns and principles</p>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ background: 'color-mix(in srgb, var(--hearth-ok) 14%, transparent)', color: 'var(--hearth-ok)' }}
                  >
                    Enabled
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-hearth-border bg-hearth-card-alt p-3">
                  <div>
                    <p className="text-sm font-medium text-hearth-text">Meeting ingestion</p>
                    <p className="text-xs text-hearth-text-muted">Process meeting transcripts for decision extraction</p>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ background: 'color-mix(in srgb, var(--hearth-ok) 14%, transparent)', color: 'var(--hearth-ok)' }}
                  >
                    Enabled
                  </span>
                </div>
              </div>
            </HCard>
          </div>
        )}
      </div>
    </div>
  );
}
