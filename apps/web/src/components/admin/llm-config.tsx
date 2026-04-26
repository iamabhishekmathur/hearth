import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface Provider {
  id: string;
  name: string;
  configured: boolean;
  keySource: 'db' | 'env' | null;
  models: string[];
  supportsVision: boolean;
  visionCapableModels: string[];
}

interface EmbeddingStatus {
  available: boolean;
  providerId: string | null;
}

interface LLMSettings {
  defaultProvider: string | null;
  defaultModel: string | null;
  visionEnabled: boolean;
}

const VISION_MODELS = new Set([
  'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001',
  'gpt-4o', 'gpt-4o-mini', 'o4-mini',
]);

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'o3': 'o3',
  'o3-mini': 'o3-mini',
  'o4-mini': 'o4-mini',
};

const OLLAMA_MODELS = ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5'];

const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI (text-embedding-3-small)',
  ollama: 'Ollama (nomic-embed-text)',
};

// ── Shared UI primitives ──

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${active ? 'bg-green-500' : 'bg-hearth-border-strong'}`} />
  );
}

function Badge({ children, variant }: { children: React.ReactNode; variant: 'green' | 'amber' | 'violet' | 'gray' }) {
  const styles = {
    green: 'bg-green-50 text-green-700 ring-green-600/20',
    amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    gray: 'bg-hearth-bg text-hearth-text-muted ring-gray-500/20',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[variant]}`}>
      {children}
    </span>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hearth-border bg-hearth-card">
      {children}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border-b border-hearth-border px-4 py-3">
      <p className="text-sm font-semibold text-hearth-text">{title}</p>
      {description && <p className="mt-0.5 text-xs text-hearth-text-muted">{description}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-hearth-accent focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-hearth-600' : 'bg-hearth-chip'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-hearth-card shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ── Provider row (inside the Providers card) ──

function ProviderRow({
  provider,
  onKeySaved,
  isLast,
}: {
  provider: Provider;
  onKeySaved: () => void;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTest = async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ data: { connected: boolean; message: string } }>(
        '/admin/setup/test-llm',
        { provider: provider.id, apiKey: apiKey.trim() },
      );
      setTestResult({ ok: res.data.connected, message: res.data.message });
    } catch {
      setTestResult({ ok: false, message: 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await api.post('/admin/llm-config/keys', {
        provider: provider.id,
        apiKey: apiKey.trim(),
      });
      setApiKey('');
      setExpanded(false);
      setTestResult(null);
      onKeySaved();
    } catch {
      setTestResult({ ok: false, message: 'Failed to save key' });
    } finally {
      setSaving(false);
    }
  };

  const label = provider.id === 'ollama' ? 'Base URL' : 'API Key';
  const placeholder = provider.id === 'ollama'
    ? 'http://localhost:11434'
    : provider.id === 'anthropic'
      ? 'sk-ant-...'
      : 'sk-...';

  return (
    <div className={!isLast ? 'border-b border-hearth-border' : ''}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <StatusDot active={provider.configured} />
          <span className="text-sm font-medium text-hearth-text">{provider.name}</span>
          {provider.configured && (
            <Badge variant="green">
              {provider.keySource === 'env' ? 'env var' : 'configured'}
            </Badge>
          )}
          {provider.configured && provider.supportsVision && (
            <Badge variant="violet">Vision</Badge>
          )}
        </div>
        {provider.keySource !== 'env' ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-hearth-600 hover:text-hearth-700"
          >
            {provider.configured ? 'Update key' : 'Configure'}
          </button>
        ) : (
          <span className="text-xs text-hearth-text-faint">Set via environment variable</span>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-hearth-border bg-hearth-bg/50 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-hearth-text-muted">{label}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder={placeholder}
              className="w-full rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-1.5 font-mono text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
              autoComplete="off"
            />
          </div>

          {testResult && (
            <p className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.ok ? '\u2713 ' : '\u2717 '}{testResult.message}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={!apiKey.trim() || testing}
              className="rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-1.5 text-xs font-medium text-hearth-text hover:bg-hearth-bg disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!testResult?.ok || saving}
              className="rounded-md bg-hearth-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setExpanded(false); setApiKey(''); setTestResult(null); }}
              className="ml-auto text-xs text-hearth-text-faint hover:text-hearth-text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──

export function LlmConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [embedding, setEmbedding] = useState<EmbeddingStatus>({ available: false, providerId: null });
  const [settings, setSettings] = useState<LLMSettings>({ defaultProvider: null, defaultModel: null, visionEnabled: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [providersRes, settingsRes] = await Promise.all([
        api.get<{ data: Provider[]; embedding: EmbeddingStatus }>('/admin/llm-config/providers'),
        api.get<{ data: LLMSettings }>('/admin/llm-config'),
      ]);
      setProviders(providersRes.data ?? []);
      setEmbedding(providersRes.embedding ?? { available: false, providerId: null });
      setSettings(settingsRes.data ?? { defaultProvider: null, defaultModel: null, visionEnabled: true });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const configuredProviders = providers.filter((p) => p.configured);
  const hasEmbeddingCapableProvider = providers.some(
    (p) => p.configured && (p.id === 'openai' || p.id === 'ollama'),
  );

  const defaultProviderModels = (): string[] => {
    const p = providers.find((p) => p.id === settings.defaultProvider);
    if (!p) return [];
    return p.models.length > 0 ? p.models : OLLAMA_MODELS;
  };

  const handleSaveDefaults = async () => {
    setSaving(true);
    setSavedMsg('');
    try {
      await api.put('/admin/llm-config', {
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
        visionEnabled: settings.visionEnabled,
      });
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 2000);
    } finally {
      setSaving(false);
    }
  };

  const selectedModelSupportsVision = settings.defaultModel ? VISION_MODELS.has(settings.defaultModel) : false;

  if (loading) return <p className="text-sm text-hearth-text-faint">Loading LLM config...</p>;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h3 className="text-base font-semibold text-hearth-text">LLM Configuration</h3>
        <p className="mt-0.5 text-sm text-hearth-text-muted">
          Connect AI providers and configure model defaults for your organization.
        </p>
      </div>

      {/* Section 1: Providers */}
      <SectionCard>
        <SectionHeader
          title="Providers"
          description="API keys for the LLM services your team uses. At least one is required for chat."
        />
        {providers.map((p, i) => (
          <ProviderRow
            key={p.id}
            provider={p}
            onKeySaved={fetchAll}
            isLast={i === providers.length - 1}
          />
        ))}
        {configuredProviders.length === 0 && (
          <div className="px-4 py-3">
            <p className="text-xs text-amber-600">
              No providers configured yet. Add at least one API key above to enable chat.
            </p>
          </div>
        )}
      </SectionCard>

      {/* Section 2: Capabilities */}
      <SectionCard>
        <SectionHeader
          title="Capabilities"
          description="Features that depend on specific provider support."
        />

        {/* Embedding row */}
        <div className="flex items-start justify-between border-b border-hearth-border px-4 py-3">
          <div className="flex items-start gap-2.5">
            <StatusDot active={embedding.available} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-hearth-text">Semantic Memory</span>
                {embedding.available && embedding.providerId && (
                  <Badge variant="green">
                    {EMBEDDING_PROVIDER_LABELS[embedding.providerId] ?? embedding.providerId}
                  </Badge>
                )}
                {!embedding.available && (
                  <Badge variant="amber">keyword-only</Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-hearth-text-muted">
                {embedding.available
                  ? 'Vector embeddings enabled — memories are searchable by meaning.'
                  : hasEmbeddingCapableProvider
                    ? 'Provider detected but not active. Restart the server or re-save your key.'
                    : 'Requires OpenAI or Ollama for vector embeddings.'}
              </p>
            </div>
          </div>
        </div>

        {/* Vision row */}
        <div className="flex items-start justify-between px-4 py-3">
          <div className="flex items-start gap-2.5">
            <StatusDot active={settings.visionEnabled && selectedModelSupportsVision} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-hearth-text">Image & Vision</span>
                {settings.visionEnabled && selectedModelSupportsVision && (
                  <Badge variant="green">active</Badge>
                )}
                {settings.visionEnabled && !selectedModelSupportsVision && settings.defaultModel && (
                  <Badge variant="amber">model may not support vision</Badge>
                )}
                {!settings.visionEnabled && (
                  <Badge variant="gray">disabled</Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-hearth-text-muted">
                Analyze images, screenshots, and attachments shared in chat.
              </p>
            </div>
          </div>
          <Toggle
            checked={settings.visionEnabled}
            onChange={() => setSettings({ ...settings, visionEnabled: !settings.visionEnabled })}
          />
        </div>
      </SectionCard>

      {/* Section 3: Defaults */}
      {configuredProviders.length > 0 && (
        <SectionCard>
          <SectionHeader
            title="Defaults"
            description="The provider and model used for new chat sessions across your org."
          />
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-hearth-text">Chat Provider</label>
                <select
                  value={settings.defaultProvider ?? ''}
                  onChange={(e) => setSettings({ ...settings, defaultProvider: e.target.value, defaultModel: '' })}
                  className="w-full rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                >
                  <option value="">Select provider...</option>
                  {configuredProviders.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-hearth-text">Chat Model</label>
                <select
                  value={settings.defaultModel ?? ''}
                  onChange={(e) => setSettings({ ...settings, defaultModel: e.target.value })}
                  disabled={!settings.defaultProvider}
                  className="w-full rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent disabled:bg-hearth-bg disabled:text-hearth-text-faint"
                >
                  <option value="">Select model...</option>
                  {defaultProviderModels().map((m) => (
                    <option key={m} value={m}>
                      {MODEL_LABELS[m] ?? m}{VISION_MODELS.has(m) ? ' \u00b7 Vision' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-hearth-border pt-4">
              <button
                type="button"
                onClick={handleSaveDefaults}
                disabled={saving || !settings.defaultProvider || !settings.defaultModel}
                className="rounded-md bg-hearth-600 px-4 py-2 text-sm font-medium text-white shadow-hearth-1 hover:bg-hearth-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Defaults'}
              </button>
              {savedMsg && <span className="text-sm font-medium text-green-600">{'\u2713'} {savedMsg}</span>}
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
