import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface Provider {
  id: string;
  name: string;
  configured: boolean;
  keySource: 'db' | 'env' | null;
  models: string[];
}

interface LLMSettings {
  defaultProvider: string | null;
  defaultModel: string | null;
}

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

function ProviderCard({
  provider,
  onKeySaved,
}: {
  provider: Provider;
  onKeySaved: () => void;
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
    <div className={`rounded-lg border ${provider.configured ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'} p-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${provider.configured ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="text-sm font-medium text-gray-900">{provider.name}</span>
          {provider.configured && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {provider.keySource === 'env' ? 'via env var' : 'configured'}
            </span>
          )}
        </div>
        {provider.keySource !== 'env' && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-hearth-600 hover:text-hearth-700"
          >
            {provider.configured ? 'Update key' : 'Configure'}
          </button>
        )}
        {provider.keySource === 'env' && (
          <span className="text-xs text-gray-400">Set via environment variable</span>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder={placeholder}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
              autoComplete="off"
            />
          </div>

          {testResult && (
            <p className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={!apiKey.trim() || testing}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!testResult?.ok || saving}
              className="rounded-lg bg-hearth-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Key'}
            </button>
            <button
              type="button"
              onClick={() => { setExpanded(false); setApiKey(''); setTestResult(null); }}
              className="ml-auto text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function LlmConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<LLMSettings>({ defaultProvider: null, defaultModel: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [providersRes, settingsRes] = await Promise.all([
        api.get<{ data: Provider[] }>('/admin/llm-config/providers'),
        api.get<{ data: LLMSettings }>('/admin/llm-config'),
      ]);
      setProviders(providersRes.data ?? []);
      setSettings(settingsRes.data ?? { defaultProvider: null, defaultModel: null });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const configuredProviders = providers.filter((p) => p.configured);

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
      });
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading LLM config...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-base font-semibold text-gray-900">LLM Configuration</h3>
        <p className="text-sm text-gray-500">Connect AI providers and set your org defaults.</p>
      </div>

      {/* Provider cards */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Providers</p>
        <div className="space-y-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onKeySaved={fetchAll} />
          ))}
        </div>
      </div>

      {/* Default settings */}
      {configuredProviders.length > 0 && (
        <div className="border-t border-gray-100 pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Defaults</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Default Provider</label>
              <select
                value={settings.defaultProvider ?? ''}
                onChange={(e) => setSettings({ ...settings, defaultProvider: e.target.value, defaultModel: '' })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none"
              >
                <option value="">Select provider...</option>
                {configuredProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Default Model</label>
              <select
                value={settings.defaultModel ?? ''}
                onChange={(e) => setSettings({ ...settings, defaultModel: e.target.value })}
                disabled={!settings.defaultProvider}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Select model...</option>
                {defaultProviderModels().map((m) => (
                  <option key={m} value={m}>{MODEL_LABELS[m] ?? m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDefaults}
              disabled={saving || !settings.defaultProvider || !settings.defaultModel}
              className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Defaults'}
            </button>
            {savedMsg && <span className="text-sm text-green-600">✓ {savedMsg}</span>}
          </div>
        </div>
      )}

      {configuredProviders.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          No providers configured yet. Add at least one API key above to enable chat.
        </p>
      )}
    </div>
  );
}
