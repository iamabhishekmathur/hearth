import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface DetectorInfo {
  id: string;
  name: string;
  entityType: string;
}

interface PackInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  detectorCount: number;
  detectors: DetectorInfo[];
  extends?: string[];
}

interface ComplianceConfig {
  enabledPacks: string[];
  detectorOverrides: Record<string, { enabled: boolean }>;
  auditLevel: 'summary' | 'detailed';
  allowUserOverride: boolean;
}

interface ComplianceStats {
  totalScrubs: number;
  entityCounts: Record<string, number>;
  packUsage: Record<string, number>;
  period: string;
}

interface TestResult {
  scrubbedText: string;
  entitiesFound: number;
  entities: Array<{ type: string; original: string; placeholder: string }>;
}

const CATEGORY_COLORS: Record<string, string> = {
  privacy: 'bg-blue-100 text-blue-700',
  financial: 'bg-amber-100 text-amber-700',
  healthcare: 'bg-green-100 text-green-700',
  education: 'bg-purple-100 text-purple-700',
};

function PackCard({
  pack,
  enabled,
  overrides,
  onToggle,
  onDetectorToggle,
}: {
  pack: PackInfo;
  enabled: boolean;
  overrides: Record<string, { enabled: boolean }>;
  onToggle: (packId: string, enabled: boolean) => void;
  onDetectorToggle: (detectorId: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        enabled ? 'border-hearth-accent bg-hearth-accent-soft' : 'border-hearth-border bg-hearth-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-hearth-text">{pack.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[pack.category] ?? 'bg-hearth-chip text-hearth-text'}`}>
              {pack.category}
            </span>
            {pack.extends && pack.extends.length > 0 && (
              <span className="text-xs text-hearth-text-faint">
                extends {pack.extends.join(', ')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-hearth-text-muted">{pack.description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(pack.id, !enabled)}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-fast"
          style={{ background: enabled ? 'var(--hearth-accent)' : 'var(--hearth-border-strong)' }}
        >
          <span
            className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-fast"
            style={{ transform: enabled ? 'translate(18px, 2px)' : 'translate(2px, 2px)' }}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-hearth-accent hover:text-hearth-text"
          >
            {expanded ? 'Hide detectors' : `Show ${pack.detectorCount} detectors`}
          </button>

          {expanded && (
            <div className="mt-2 space-y-1.5 rounded-lg bg-hearth-card p-3">
              {pack.detectors.map((d) => {
                const override = overrides[d.id];
                const detectorEnabled = override?.enabled !== false;
                return (
                  <div key={d.id} className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-hearth-text">{d.name}</span>
                      <span className="ml-2 text-xs text-hearth-text-faint">{d.entityType}</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={detectorEnabled}
                      onClick={() => onDetectorToggle(d.id, !detectorEnabled)}
                      className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors duration-fast"
                      style={{ background: detectorEnabled ? 'var(--hearth-accent)' : 'var(--hearth-border-strong)' }}
                    >
                      <span
                        className="pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-fast"
                        style={{ transform: detectorEnabled ? 'translate(12px, 2px)' : 'translate(2px, 2px)' }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TestPanel({ enabledPacks }: { enabledPacks: string[] }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    if (!text.trim() || enabledPacks.length === 0) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await api.post<{ data: TestResult }>('/admin/compliance/test', {
        text: text.trim(),
        packIds: enabledPacks,
      });
      setResult(res.data);
    } catch {
      setResult(null);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Test Text</label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setResult(null); }}
          placeholder="Enter text containing sensitive data to test detection..."
          rows={3}
          className="w-full rounded-lg border border-hearth-border-strong p-3 text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
        />
      </div>

      <button
        type="button"
        onClick={handleTest}
        disabled={!text.trim() || enabledPacks.length === 0 || testing}
        className="rounded-lg bg-hearth-text px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {testing ? 'Testing...' : 'Test Detection'}
      </button>

      {result && (
        <div className="rounded-lg border border-hearth-border bg-hearth-bg p-3 text-sm">
          <p className="font-medium text-hearth-text">
            {result.entitiesFound} {result.entitiesFound === 1 ? 'entity' : 'entities'} detected
          </p>
          {result.entitiesFound > 0 && (
            <>
              <div className="mt-2">
                <p className="text-xs font-medium text-hearth-text-muted">Scrubbed output:</p>
                <p className="mt-1 whitespace-pre-wrap rounded bg-hearth-card p-2 font-mono text-xs text-hearth-text">
                  {result.scrubbedText}
                </p>
              </div>
              <div className="mt-2">
                <p className="text-xs font-medium text-hearth-text-muted">Entities:</p>
                <div className="mt-1 space-y-1">
                  {result.entities.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">{e.type}</span>
                      <span className="text-hearth-text-muted">&quot;{e.original}&quot;</span>
                      <span className="text-hearth-text-faint">&rarr;</span>
                      <span className="font-mono text-hearth-accent">{e.placeholder}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {result.entitiesFound === 0 && (
            <p className="mt-1 text-xs text-hearth-text-muted">No sensitive data detected in the input.</p>
          )}
        </div>
      )}
    </div>
  );
}

function StatsPanel({ stats }: { stats: ComplianceStats | null }) {
  if (!stats || stats.totalScrubs === 0) {
    return (
      <p className="text-xs text-hearth-text-faint">No scrubbing activity in the last 30 days.</p>
    );
  }

  const topEntities = Object.entries(stats.entityCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-hearth-card-alt p-3">
          <p className="text-2xl font-bold text-hearth-text">{stats.totalScrubs}</p>
          <p className="text-xs text-hearth-accent">Total scrub operations</p>
        </div>
        <div className="rounded-lg bg-hearth-card-alt p-3">
          <p className="text-2xl font-bold text-hearth-text">
            {Object.values(stats.entityCounts).reduce((a, b) => a + b, 0)}
          </p>
          <p className="text-xs text-hearth-accent">Total entities scrubbed</p>
        </div>
      </div>

      {topEntities.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-hearth-text-muted">Top entity types</p>
          <div className="space-y-1">
            {topEntities.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <span className="font-medium text-hearth-text">{type}</span>
                <span className="text-hearth-text-muted">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(stats.packUsage).length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-hearth-text-muted">Pack usage</p>
          <div className="space-y-1">
            {Object.entries(stats.packUsage)
              .sort(([, a], [, b]) => b - a)
              .map(([pack, count]) => (
                <div key={pack} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-hearth-text">{pack}</span>
                  <span className="text-hearth-text-muted">{count} scrubs</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ComplianceConfig() {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [config, setConfig] = useState<ComplianceConfig>({
    enabledPacks: [],
    detectorOverrides: {},
    auditLevel: 'summary',
    allowUserOverride: false,
  });
  const [stats, setStats] = useState<ComplianceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [packsRes, configRes, statsRes] = await Promise.all([
        api.get<{ data: PackInfo[] }>('/admin/compliance/packs'),
        api.get<{ data: ComplianceConfig }>('/admin/compliance/config'),
        api.get<{ data: ComplianceStats }>('/admin/compliance/stats'),
      ]);
      setPacks(packsRes.data ?? []);
      setConfig(configRes.data ?? {
        enabledPacks: [],
        detectorOverrides: {},
        auditLevel: 'summary',
        allowUserOverride: false,
      });
      setStats(statsRes.data ?? null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handlePackToggle = (packId: string, enabled: boolean) => {
    setConfig((prev) => ({
      ...prev,
      enabledPacks: enabled
        ? [...prev.enabledPacks, packId]
        : prev.enabledPacks.filter((id) => id !== packId),
    }));
  };

  const handleDetectorToggle = (detectorId: string, enabled: boolean) => {
    setConfig((prev) => {
      const overrides = { ...prev.detectorOverrides };
      if (enabled) {
        delete overrides[detectorId];
      } else {
        overrides[detectorId] = { enabled: false };
      }
      return { ...prev, detectorOverrides: overrides };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg('');
    try {
      await api.put('/admin/compliance/config', config);
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch {
      setSavedMsg('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-hearth-text-faint">Loading compliance config...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-base font-semibold text-hearth-text">Compliance Packs</h3>
        <p className="text-sm text-hearth-text-muted">
          Enable compliance packs to automatically detect and scrub sensitive data before it reaches external LLM providers.
          Scrubbing happens transparently — users see original values in responses, but the LLM only sees placeholders.
        </p>
      </div>

      {/* Pack cards */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">Available Packs</p>
        <div className="space-y-2">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              enabled={config.enabledPacks.includes(pack.id)}
              overrides={config.detectorOverrides}
              onToggle={handlePackToggle}
              onDetectorToggle={handleDetectorToggle}
            />
          ))}
        </div>
      </div>

      {/* Settings */}
      <div className="border-t border-hearth-border pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">Settings</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-hearth-text">Audit Level</span>
              <p className="text-xs text-hearth-text-faint">
                Summary logs entity counts; detailed logs entity types per request.
              </p>
            </div>
            <select
              value={config.auditLevel}
              onChange={(e) =>
                setConfig({ ...config, auditLevel: e.target.value as 'summary' | 'detailed' })
              }
              className="rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm focus:border-hearth-accent focus:outline-none"
            >
              <option value="summary">Summary</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-hearth-text">Allow User Override</span>
              <p className="text-xs text-hearth-text-faint">
                {'Let users bypass scrubbing for specific content using <safe> tags.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.allowUserOverride}
              onClick={() => setConfig({ ...config, allowUserOverride: !config.allowUserOverride })}
              className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-fast"
              style={{ background: config.allowUserOverride ? 'var(--hearth-accent)' : 'var(--hearth-border-strong)' }}
            >
              <span
                className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-fast"
                style={{ transform: config.allowUserOverride ? 'translate(18px, 2px)' : 'translate(2px, 2px)' }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-hearth-text px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        {savedMsg && (
          <span className={`text-sm ${savedMsg === 'Saved' ? 'text-green-600' : 'text-red-600'}`}>
            {savedMsg === 'Saved' ? '\u2713 ' : ''}{savedMsg}
          </span>
        )}
      </div>

      {/* Test panel */}
      {config.enabledPacks.length > 0 && (
        <div className="border-t border-hearth-border pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">Test Detection</p>
          <TestPanel enabledPacks={config.enabledPacks} />
        </div>
      )}

      {/* Stats */}
      <div className="border-t border-hearth-border pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">
          Scrubbing Statistics (Last 30 Days)
        </p>
        <StatsPanel stats={stats} />
      </div>
    </div>
  );
}
