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
        enabled ? 'border-hearth-200 bg-hearth-50/50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{pack.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[pack.category] ?? 'bg-gray-100 text-gray-700'}`}>
              {pack.category}
            </span>
            {pack.extends && pack.extends.length > 0 && (
              <span className="text-xs text-gray-400">
                extends {pack.extends.join(', ')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">{pack.description}</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(pack.id, e.target.checked)}
            className="peer sr-only"
          />
          <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-hearth-600 peer-checked:after:translate-x-full peer-checked:after:border-white" />
        </label>
      </div>

      {enabled && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-hearth-600 hover:text-hearth-700"
          >
            {expanded ? 'Hide detectors' : `Show ${pack.detectorCount} detectors`}
          </button>

          {expanded && (
            <div className="mt-2 space-y-1.5 rounded-lg bg-white p-3">
              {pack.detectors.map((d) => {
                const override = overrides[d.id];
                const detectorEnabled = override?.enabled !== false;
                return (
                  <div key={d.id} className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-gray-700">{d.name}</span>
                      <span className="ml-2 text-xs text-gray-400">{d.entityType}</span>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={detectorEnabled}
                        onChange={(e) => onDetectorToggle(d.id, e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-4 w-7 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-hearth-500 peer-checked:after:translate-x-full" />
                    </label>
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
        <label className="mb-1 block text-xs font-medium text-gray-600">Test Text</label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setResult(null); }}
          placeholder="Enter text containing sensitive data to test detection..."
          rows={3}
          className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
        />
      </div>

      <button
        type="button"
        onClick={handleTest}
        disabled={!text.trim() || enabledPacks.length === 0 || testing}
        className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
      >
        {testing ? 'Testing...' : 'Test Detection'}
      </button>

      {result && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="font-medium text-gray-700">
            {result.entitiesFound} {result.entitiesFound === 1 ? 'entity' : 'entities'} detected
          </p>
          {result.entitiesFound > 0 && (
            <>
              <div className="mt-2">
                <p className="text-xs font-medium text-gray-500">Scrubbed output:</p>
                <p className="mt-1 whitespace-pre-wrap rounded bg-white p-2 font-mono text-xs text-gray-800">
                  {result.scrubbedText}
                </p>
              </div>
              <div className="mt-2">
                <p className="text-xs font-medium text-gray-500">Entities:</p>
                <div className="mt-1 space-y-1">
                  {result.entities.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">{e.type}</span>
                      <span className="text-gray-500">&quot;{e.original}&quot;</span>
                      <span className="text-gray-400">&rarr;</span>
                      <span className="font-mono text-hearth-600">{e.placeholder}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {result.entitiesFound === 0 && (
            <p className="mt-1 text-xs text-gray-500">No sensitive data detected in the input.</p>
          )}
        </div>
      )}
    </div>
  );
}

function StatsPanel({ stats }: { stats: ComplianceStats | null }) {
  if (!stats || stats.totalScrubs === 0) {
    return (
      <p className="text-xs text-gray-400">No scrubbing activity in the last 30 days.</p>
    );
  }

  const topEntities = Object.entries(stats.entityCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-hearth-50 p-3">
          <p className="text-2xl font-bold text-hearth-700">{stats.totalScrubs}</p>
          <p className="text-xs text-hearth-600">Total scrub operations</p>
        </div>
        <div className="rounded-lg bg-hearth-50 p-3">
          <p className="text-2xl font-bold text-hearth-700">
            {Object.values(stats.entityCounts).reduce((a, b) => a + b, 0)}
          </p>
          <p className="text-xs text-hearth-600">Total entities scrubbed</p>
        </div>
      </div>

      {topEntities.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Top entity types</p>
          <div className="space-y-1">
            {topEntities.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700">{type}</span>
                <span className="text-gray-500">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(stats.packUsage).length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Pack usage</p>
          <div className="space-y-1">
            {Object.entries(stats.packUsage)
              .sort(([, a], [, b]) => b - a)
              .map(([pack, count]) => (
                <div key={pack} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{pack}</span>
                  <span className="text-gray-500">{count} scrubs</span>
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

  if (loading) return <p className="text-sm text-gray-400">Loading compliance config...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-base font-semibold text-gray-900">Compliance Packs</h3>
        <p className="text-sm text-gray-500">
          Enable compliance packs to automatically detect and scrub sensitive data before it reaches external LLM providers.
          Scrubbing happens transparently — users see original values in responses, but the LLM only sees placeholders.
        </p>
      </div>

      {/* Pack cards */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Available Packs</p>
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
      <div className="border-t border-gray-100 pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Settings</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-700">Audit Level</span>
              <p className="text-xs text-gray-400">
                Summary logs entity counts; detailed logs entity types per request.
              </p>
            </div>
            <select
              value={config.auditLevel}
              onChange={(e) =>
                setConfig({ ...config, auditLevel: e.target.value as 'summary' | 'detailed' })
              }
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none"
            >
              <option value="summary">Summary</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-700">Allow User Override</span>
              <p className="text-xs text-gray-400">
                {'Let users bypass scrubbing for specific content using <safe> tags.'}
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={config.allowUserOverride}
                onChange={(e) =>
                  setConfig({ ...config, allowUserOverride: e.target.checked })
                }
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-hearth-600 peer-checked:after:translate-x-full peer-checked:after:border-white" />
            </label>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
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
        <div className="border-t border-gray-100 pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Test Detection</p>
          <TestPanel enabledPacks={config.enabledPacks} />
        </div>
      )}

      {/* Stats */}
      <div className="border-t border-gray-100 pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Scrubbing Statistics (Last 30 Days)
        </p>
        <StatsPanel stats={stats} />
      </div>
    </div>
  );
}
