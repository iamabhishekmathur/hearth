import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type {
  GovernancePolicy,
  GovernanceViolation,
  GovernanceSettings,
  GovernanceStats,
  GovernanceSeverity,
  GovernanceEnforcement,
  GovernanceRuleType,
  GovernanceViolationStatus,
  PaginatedResponse,
} from '@hearth/shared';

// ── Severity badge ──

function SeverityBadge({ severity }: { severity: GovernanceSeverity }) {
  const colors: Record<GovernanceSeverity, string> = {
    info: 'bg-blue-100 text-blue-700',
    warning: 'bg-amber-100 text-amber-700',
    critical: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[severity]}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: GovernanceViolationStatus }) {
  const colors: Record<GovernanceViolationStatus, string> = {
    open: 'bg-blue-100 text-blue-700',
    acknowledged: 'bg-green-100 text-green-700',
    dismissed: 'bg-hearth-chip text-hearth-text-muted',
    escalated: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status}
    </span>
  );
}

function EnforcementBadge({ enforcement }: { enforcement: GovernanceEnforcement }) {
  const colors: Record<GovernanceEnforcement, string> = {
    monitor: 'bg-hearth-chip text-hearth-text-muted',
    warn: 'bg-amber-100 text-amber-700',
    block: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[enforcement]}`}>
      {enforcement}
    </span>
  );
}

// ── Settings Panel ──

function SettingsPanel({
  settings,
  onSave,
}: {
  settings: GovernanceSettings;
  onSave: (s: GovernanceSettings) => Promise<void>;
}) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setLocal(settings), [settings]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(local);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const Toggle = ({
    label,
    description,
    checked,
    onChange,
  }: {
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <div className="flex items-center justify-between rounded-lg border border-hearth-border bg-hearth-card p-3">
      <div>
        <p className="text-sm font-medium text-hearth-text">{label}</p>
        <p className="text-xs text-hearth-text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          checked ? 'bg-hearth-600' : 'bg-hearth-chip'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-hearth-card shadow transition ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      <Toggle
        label="Enable governance monitoring"
        description="Monitor chat messages against organizational policies"
        checked={local.enabled}
        onChange={(v) => setLocal({ ...local, enabled: v })}
      />
      <Toggle
        label="Check user messages"
        description="Evaluate outgoing user messages against policies"
        checked={local.checkUserMessages}
        onChange={(v) => setLocal({ ...local, checkUserMessages: v })}
      />
      <Toggle
        label="Check AI responses"
        description="Evaluate AI assistant responses against policies"
        checked={local.checkAiResponses}
        onChange={(v) => setLocal({ ...local, checkAiResponses: v })}
      />
      <Toggle
        label="Show monitoring banner"
        description="Display a governance monitoring notice in the chat interface"
        checked={local.monitoringBanner}
        onChange={(v) => setLocal({ ...local, monitoringBanner: v })}
      />
      <Toggle
        label="Real-time admin notifications"
        description="Push notifications to admins when violations are detected"
        checked={local.notifyAdmins}
        onChange={(v) => setLocal({ ...local, notifyAdmins: v })}
      />
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {saved && <span className="text-sm text-green-600">{'\u2713'} Saved</span>}
      </div>
    </div>
  );
}

// ── Policy Form ──

interface PolicyFormData {
  name: string;
  description: string;
  category: string;
  severity: GovernanceSeverity;
  ruleType: GovernanceRuleType;
  ruleConfig: Record<string, unknown>;
  enforcement: GovernanceEnforcement;
}

const DEFAULT_FORM: PolicyFormData = {
  name: '',
  description: '',
  category: 'custom',
  severity: 'warning',
  ruleType: 'keyword',
  ruleConfig: { keywords: [], matchMode: 'any', caseSensitive: false },
  enforcement: 'monitor',
};

function PolicyForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PolicyFormData;
  onSave: (data: PolicyFormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PolicyFormData>(initial ?? DEFAULT_FORM);
  const [keywordText, setKeywordText] = useState(
    ((initial?.ruleConfig?.keywords as string[]) ?? []).join(', '),
  );
  const [saving, setSaving] = useState(false);

  const handleRuleTypeChange = (ruleType: GovernanceRuleType) => {
    let ruleConfig: Record<string, unknown>;
    if (ruleType === 'keyword') {
      ruleConfig = { keywords: [], matchMode: 'any', caseSensitive: false };
      setKeywordText('');
    } else if (ruleType === 'regex') {
      ruleConfig = { pattern: '', flags: 'i' };
    } else {
      ruleConfig = { prompt: '' };
    }
    setForm({ ...form, ruleType, ruleConfig });
  };

  const handleSubmit = async () => {
    let finalConfig = form.ruleConfig;
    if (form.ruleType === 'keyword') {
      const keywords = keywordText
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      finalConfig = { ...finalConfig, keywords };
    }
    setSaving(true);
    await onSave({ ...form, ruleConfig: finalConfig });
    setSaving(false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-hearth-border bg-hearth-bg p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Policy name"
            className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Category</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
          >
            <option value="data_privacy">Data Privacy</option>
            <option value="ip_protection">IP Protection</option>
            <option value="compliance">Compliance</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Description (optional)</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe what this policy protects against..."
          rows={2}
          className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Severity</label>
          <select
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value as GovernanceSeverity })}
            className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Rule Type</label>
          <select
            value={form.ruleType}
            onChange={(e) => handleRuleTypeChange(e.target.value as GovernanceRuleType)}
            className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
          >
            <option value="keyword">Keyword</option>
            <option value="regex">Regex</option>
            <option value="llm_evaluation">LLM Evaluation</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Enforcement</label>
          <select
            value={form.enforcement}
            onChange={(e) => setForm({ ...form, enforcement: e.target.value as GovernanceEnforcement })}
            className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
          >
            <option value="monitor">Monitor</option>
            <option value="warn">Warn</option>
            <option value="block">Block</option>
          </select>
        </div>
      </div>

      {/* Rule Config */}
      {form.ruleType === 'keyword' && (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Keywords (comma-separated)</label>
            <textarea
              value={keywordText}
              onChange={(e) => setKeywordText(e.target.value)}
              placeholder="password, SSN, credit card, social security..."
              rows={2}
              className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 font-mono text-sm focus:border-hearth-accent focus:outline-none"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-xs text-hearth-text-muted">
              <input
                type="checkbox"
                checked={(form.ruleConfig.caseSensitive as boolean) ?? false}
                onChange={(e) =>
                  setForm({ ...form, ruleConfig: { ...form.ruleConfig, caseSensitive: e.target.checked } })
                }
              />
              Case sensitive
            </label>
            <label className="flex items-center gap-1.5 text-xs text-hearth-text-muted">
              Match mode:
              <select
                value={(form.ruleConfig.matchMode as string) ?? 'any'}
                onChange={(e) =>
                  setForm({ ...form, ruleConfig: { ...form.ruleConfig, matchMode: e.target.value } })
                }
                className="rounded border border-hearth-border-strong px-1 py-0.5 text-xs"
              >
                <option value="any">Any keyword</option>
                <option value="all">All keywords</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {form.ruleType === 'regex' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Pattern</label>
            <input
              type="text"
              value={(form.ruleConfig.pattern as string) ?? ''}
              onChange={(e) => setForm({ ...form, ruleConfig: { ...form.ruleConfig, pattern: e.target.value } })}
              placeholder="\b\d{3}-\d{2}-\d{4}\b"
              className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 font-mono text-sm focus:border-hearth-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Flags</label>
            <input
              type="text"
              value={(form.ruleConfig.flags as string) ?? 'i'}
              onChange={(e) => setForm({ ...form, ruleConfig: { ...form.ruleConfig, flags: e.target.value } })}
              placeholder="i"
              className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 font-mono text-sm focus:border-hearth-accent focus:outline-none"
            />
          </div>
        </div>
      )}

      {form.ruleType === 'llm_evaluation' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Evaluation Prompt</label>
          <textarea
            value={(form.ruleConfig.prompt as string) ?? ''}
            onChange={(e) => setForm({ ...form, ruleConfig: { ...form.ruleConfig, prompt: e.target.value } })}
            placeholder="Does this message attempt to share customer PII such as names, emails, phone numbers, or addresses?"
            rows={3}
            className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-hearth-text-faint">
            Describe what this policy should detect. The AI will evaluate each message against this description.
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !form.name.trim()}
          className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Policy'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-hearth-border-strong px-4 py-2 text-sm font-medium text-hearth-text hover:bg-hearth-bg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Policy Management ──

function PolicyManagement({
  policies,
  onRefresh,
}: {
  policies: GovernancePolicy[];
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<GovernancePolicy | null>(null);

  const handleCreate = async (data: PolicyFormData) => {
    await api.post('/admin/governance/policies', data);
    setShowForm(false);
    onRefresh();
  };

  const handleUpdate = async (data: PolicyFormData) => {
    if (!editingPolicy) return;
    await api.put(`/admin/governance/policies/${editingPolicy.id}`, data);
    setEditingPolicy(null);
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this policy and all its violations?')) return;
    await api.delete(`/admin/governance/policies/${id}`);
    onRefresh();
  };

  const handleToggle = async (policy: GovernancePolicy) => {
    await api.put(`/admin/governance/policies/${policy.id}`, { enabled: !policy.enabled });
    onRefresh();
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">Policies</p>
        <button
          type="button"
          onClick={() => { setShowForm(true); setEditingPolicy(null); }}
          className="rounded-lg bg-hearth-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-700"
        >
          Create Policy
        </button>
      </div>

      {showForm && (
        <div className="mb-4">
          <PolicyForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {editingPolicy && (
        <div className="mb-4">
          <PolicyForm
            initial={{
              name: editingPolicy.name,
              description: editingPolicy.description ?? '',
              category: editingPolicy.category,
              severity: editingPolicy.severity,
              ruleType: editingPolicy.ruleType,
              ruleConfig: editingPolicy.ruleConfig,
              enforcement: editingPolicy.enforcement,
            }}
            onSave={handleUpdate}
            onCancel={() => setEditingPolicy(null)}
          />
        </div>
      )}

      {policies.length === 0 ? (
        <p className="rounded-lg bg-hearth-bg px-4 py-3 text-sm text-hearth-text-muted">
          No policies configured. Create a policy to start monitoring.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hearth-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hearth-border bg-hearth-bg text-xs uppercase text-hearth-text-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Enforcement</th>
                <th className="px-3 py-2 text-right">Violations</th>
                <th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {policies.map((p) => (
                <tr key={p.id} className="hover:bg-hearth-bg">
                  <td className="px-3 py-2 font-medium text-hearth-text">{p.name}</td>
                  <td className="px-3 py-2 text-hearth-text-muted">{p.category.replace('_', ' ')}</td>
                  <td className="px-3 py-2"><SeverityBadge severity={p.severity} /></td>
                  <td className="px-3 py-2 text-hearth-text-muted">{p.ruleType.replace('_', ' ')}</td>
                  <td className="px-3 py-2"><EnforcementBadge enforcement={p.enforcement} /></td>
                  <td className="px-3 py-2 text-right text-hearth-text-muted">{p.violationCount ?? 0}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(p)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        p.enabled ? 'bg-hearth-600' : 'bg-hearth-chip'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-hearth-card shadow transition ${
                          p.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => { setEditingPolicy(p); setShowForm(false); }}
                        className="rounded p-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
                        title="Edit"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        className="rounded p-1 text-hearth-text-faint hover:bg-red-50 hover:text-red-600"
                        title="Delete"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Violations Dashboard ──

function ViolationsDashboard({ stats }: { stats: GovernanceStats | null }) {
  const [violations, setViolations] = useState<GovernanceViolation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const pageSize = 10;

  const fetchViolations = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (severityFilter) params.set('severity', severityFilter);
    if (statusFilter) params.set('status', statusFilter);
    try {
      const res = await api.get<PaginatedResponse<GovernanceViolation>>(
        `/admin/governance/violations?${params}`,
      );
      setViolations(res.data);
      setTotal(res.total);
    } catch {
      // ignore
    }
  }, [page, severityFilter, statusFilter]);

  useEffect(() => {
    fetchViolations();
  }, [fetchViolations]);

  const handleReview = async (violationId: string, status: 'acknowledged' | 'dismissed' | 'escalated') => {
    if (status === 'escalated' && !reviewNote.trim()) return;
    await api.patch(`/admin/governance/violations/${violationId}`, {
      status,
      note: reviewNote || undefined,
    });
    setReviewNote('');
    setExpandedId(null);
    fetchViolations();
  };

  const handleExport = async (format: 'csv' | 'json') => {
    const res = await fetch(`/api/v1/admin/governance/export?format=${format}`, {
      credentials: 'include',
      headers: {
        'x-csrf-token': document.cookie.match(/hearth\.csrf=([^;]+)/)?.[1] ?? '',
      },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `violations.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / pageSize);
  const maxCount = stats ? Math.max(...stats.byDay.map((d) => d.count), 1) : 1;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-hearth-border bg-hearth-card p-3">
            <p className="text-xs text-hearth-text-muted">Total (30d)</p>
            <p className="text-xl font-bold text-hearth-text">{stats.totalViolations}</p>
          </div>
          <div className="rounded-lg border border-hearth-border bg-hearth-card p-3">
            <p className="text-xs text-hearth-text-muted">Open</p>
            <p className="text-xl font-bold text-blue-600">{stats.openViolations}</p>
          </div>
          <div className="rounded-lg border border-hearth-border bg-hearth-card p-3">
            <p className="text-xs text-hearth-text-muted">Critical</p>
            <p className="text-xl font-bold text-red-600">{stats.bySeverity.critical}</p>
          </div>
          <div className="rounded-lg border border-hearth-border bg-hearth-card p-3">
            <p className="text-xs text-hearth-text-muted">Warning</p>
            <p className="text-xl font-bold text-amber-600">{stats.bySeverity.warning}</p>
          </div>
        </div>
      )}

      {/* Trend Chart */}
      {stats && stats.byDay.length > 0 && (
        <div className="rounded-lg border border-hearth-border bg-hearth-card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">Violations (30d)</p>
          <div className="flex items-end gap-1" style={{ height: 80 }}>
            {stats.byDay.map((day) => (
              <div key={day.date} className="flex-1">
                <div
                  className="w-full rounded-t bg-hearth-500"
                  style={{ height: `${(day.count / maxCount) * 100}%`, minHeight: day.count > 0 ? 2 : 0 }}
                  title={`${day.date}: ${day.count} violations`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + Export */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-hearth-border-strong px-2 py-1.5 text-xs focus:border-hearth-accent focus:outline-none"
        >
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-hearth-border-strong px-2 py-1.5 text-xs focus:border-hearth-accent focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="dismissed">Dismissed</option>
          <option value="escalated">Escalated</option>
        </select>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="rounded border border-hearth-border-strong px-2 py-1 text-xs text-hearth-text-muted hover:bg-hearth-bg"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('json')}
            className="rounded border border-hearth-border-strong px-2 py-1 text-xs text-hearth-text-muted hover:bg-hearth-bg"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Violations Table */}
      {violations.length === 0 ? (
        <p className="rounded-lg bg-hearth-bg px-4 py-3 text-sm text-hearth-text-muted">
          No violations found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hearth-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hearth-border bg-hearth-bg text-xs uppercase text-hearth-text-muted">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Policy</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Snippet</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {violations.map((v) => (
                <tr key={v.id}>
                  <td colSpan={6} className="p-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                      className={`flex w-full text-left hover:bg-hearth-bg ${v.severity === 'critical' ? 'border-l-2 border-red-400' : ''}`}
                    >
                      <td className="px-3 py-2 text-xs text-hearth-text-muted whitespace-nowrap">
                        {new Date(v.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-hearth-text">{v.userName ?? v.userId.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-hearth-text">{v.policyName ?? 'Unknown'}</td>
                      <td className="px-3 py-2"><SeverityBadge severity={v.severity} /></td>
                      <td className="px-3 py-2 max-w-xs truncate text-hearth-text-muted">{v.contentSnippet.slice(0, 80)}</td>
                      <td className="px-3 py-2"><StatusBadge status={v.status} /></td>
                    </button>

                    {/* Expanded details */}
                    {expandedId === v.id && (
                      <div className="border-t border-hearth-border bg-hearth-bg px-4 py-3 space-y-3">
                        <div>
                          <p className="text-xs font-medium text-hearth-text-muted">Full Snippet</p>
                          <p className="mt-1 rounded bg-hearth-card p-2 text-xs text-hearth-text whitespace-pre-wrap border border-hearth-border">
                            {v.contentSnippet}
                          </p>
                        </div>
                        <div className="flex gap-4 text-xs text-hearth-text-muted">
                          <span>Role: {v.messageRole}</span>
                          <span>Enforcement: <EnforcementBadge enforcement={v.enforcement} /></span>
                          {v.sessionId && v.sessionId !== 'test' && (
                            <a href={`/#/chat/${v.sessionId}`} className="text-hearth-600 hover:underline">
                              View session
                            </a>
                          )}
                        </div>
                        {v.matchDetails && Object.keys(v.matchDetails).length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-hearth-text-muted">Match Details</p>
                            <pre className="mt-1 rounded bg-hearth-card p-2 text-xs text-hearth-text-muted border border-hearth-border overflow-auto">
                              {JSON.stringify(v.matchDetails, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Review actions */}
                        {v.status === 'open' && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleReview(v.id, 'acknowledged')}
                              className="rounded bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200"
                            >
                              Acknowledge
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReview(v.id, 'dismissed')}
                              className="rounded bg-hearth-chip px-3 py-1 text-xs font-medium text-hearth-text-muted hover:bg-hearth-chip"
                            >
                              Dismiss
                            </button>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                                placeholder="Escalation note (required)"
                                className="rounded border border-hearth-border-strong px-2 py-1 text-xs focus:border-red-400 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleReview(v.id, 'escalated')}
                                disabled={!reviewNote.trim()}
                                className="rounded bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                              >
                                Escalate
                              </button>
                            </div>
                          </div>
                        )}

                        {v.status !== 'open' && v.reviewNote && (
                          <div>
                            <p className="text-xs font-medium text-hearth-text-muted">Review Note</p>
                            <p className="mt-1 text-xs text-hearth-text-muted">{v.reviewNote}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-hearth-text-muted">
            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded border border-hearth-border-strong px-2 py-1 text-xs disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="rounded border border-hearth-border-strong px-2 py-1 text-xs disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export function GovernanceConfig() {
  const [settings, setSettings] = useState<GovernanceSettings>({
    enabled: false,
    checkUserMessages: true,
    checkAiResponses: false,
    notifyAdmins: true,
    monitoringBanner: true,
  });
  const [policies, setPolicies] = useState<GovernancePolicy[]>([]);
  const [stats, setStats] = useState<GovernanceStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [settingsRes, policiesRes, statsRes] = await Promise.all([
        api.get<{ data: GovernanceSettings }>('/admin/governance/settings'),
        api.get<{ data: GovernancePolicy[] }>('/admin/governance/policies'),
        api.get<{ data: GovernanceStats }>('/admin/governance/stats'),
      ]);
      setSettings(settingsRes.data);
      setPolicies(policiesRes.data);
      setStats(statsRes.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleSaveSettings = async (newSettings: GovernanceSettings) => {
    await api.put('/admin/governance/settings', newSettings);
    setSettings(newSettings);
  };

  if (loading) return <p className="text-sm text-hearth-text-faint">Loading governance config...</p>;

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-1 text-base font-semibold text-hearth-text">Governance Monitoring</h3>
        <p className="text-sm text-hearth-text-muted">
          Define policies to monitor chat messages for compliance violations. Violations are logged and can be reviewed by admins.
        </p>
      </div>

      {/* Settings */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">Settings</p>
        <SettingsPanel settings={settings} onSave={handleSaveSettings} />
      </div>

      {/* Policies */}
      <div className="border-t border-hearth-border pt-5">
        <PolicyManagement policies={policies} onRefresh={fetchAll} />
      </div>

      {/* Violations */}
      <div className="border-t border-hearth-border pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">Violations</p>
        <ViolationsDashboard stats={stats} />
      </div>
    </div>
  );
}
