import { useState } from 'react';
import { api } from '@/lib/api-client';

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = 'admin' | 'llm' | 'done';

type Provider = 'anthropic' | 'openai' | 'ollama';

const PROVIDERS: { id: Provider; name: string; label: string; placeholder: string; hint: string }[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    label: 'API Key',
    placeholder: 'sk-ant-...',
    hint: 'Find your key at console.anthropic.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    label: 'API Key',
    placeholder: 'sk-...',
    hint: 'Find your key at platform.openai.com',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    label: 'Base URL',
    placeholder: 'http://localhost:11434',
    hint: 'Run Ollama locally and enter its base URL',
  },
];

const MODELS: Record<Provider, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most capable)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (recommended)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (fastest)' },
    { value: 'o3', label: 'o3 (reasoning)' },
    { value: 'o3-mini', label: 'o3-mini (fast reasoning)' },
    { value: 'o4-mini', label: 'o4-mini (fast reasoning)' },
  ],
  ollama: [
    { value: 'llama3.2', label: 'Llama 3.2' },
    { value: 'llama3.1', label: 'Llama 3.1' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'qwen2.5', label: 'Qwen 2.5' },
  ],
};

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Admin form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');

  // LLM form
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/admin/setup/init', { email, password, name, orgName });
      setStep('llm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProvider = (id: Provider) => {
    setSelectedProvider(id);
    setApiKey('');
    setTestStatus('idle');
    setTestMessage('');
    setSelectedModel(MODELS[id][0]?.value ?? '');
  };

  const handleTest = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    setTestStatus('testing');
    setTestMessage('');
    try {
      const res = await api.post<{ data: { connected: boolean; message: string } }>(
        '/admin/setup/test-llm',
        { provider: selectedProvider, apiKey: apiKey.trim() },
      );
      if (res.data.connected) {
        setTestStatus('ok');
        setTestMessage(res.data.message);
      } else {
        setTestStatus('fail');
        setTestMessage(res.data.message);
      }
    } catch {
      setTestStatus('fail');
      setTestMessage('Connection test failed');
    }
  };

  const handleSaveLlm = async () => {
    if (!selectedProvider || !apiKey.trim() || !selectedModel) return;
    setSaving(true);
    try {
      // Save the API key
      await api.post('/admin/llm-config/keys', {
        provider: selectedProvider,
        apiKey: apiKey.trim(),
      });
      // Save default provider + model
      await api.put('/admin/llm-config', {
        defaultProvider: selectedProvider,
        defaultModel: selectedModel,
      });
      setStep('done');
      onComplete();
    } catch {
      setTestStatus('fail');
      setTestMessage('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  if (step === 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hearth-bg p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-hearth-accent">Welcome to Hearth</h1>
            <p className="mt-2 text-hearth-text-muted">Let's set up your workspace</p>
          </div>
          <div className="rounded-xl bg-hearth-card p-6 shadow-hearth-1">
            <h2 className="mb-4 text-lg font-semibold text-hearth-text">Create Admin Account</h2>
            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-hearth-text">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-hearth-text">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-hearth-text">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-hearth-text">
                  Organization Name <span className="text-hearth-text-faint">(optional)</span>
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="My Company"
                  className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--hearth-accent)' }}
              >
                {loading ? 'Creating...' : 'Create Admin Account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'llm') {
    const provider = selectedProvider ? PROVIDERS.find((p) => p.id === selectedProvider) : null;
    const canTest = !!selectedProvider && !!apiKey.trim();
    const canSave = testStatus === 'ok' && !!selectedModel;

    return (
      <div className="flex min-h-screen items-center justify-center bg-hearth-bg p-4">
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-hearth-accent">Connect an AI Provider</h1>
            <p className="mt-1.5 text-sm text-hearth-text-muted">
              Hearth needs an LLM to power the chat and agent features.
            </p>
          </div>

          <div className="rounded-xl bg-hearth-card p-6 shadow-hearth-1">
            {/* Provider selection */}
            <p className="mb-3 text-sm font-medium text-hearth-text">Choose a provider</p>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProvider(p.id)}
                  className={`rounded-lg border px-4 py-3 text-center text-sm font-medium transition-colors ${
                    selectedProvider === p.id
                      ? 'border-hearth-500 bg-hearth-50 text-hearth-700'
                      : 'border-hearth-border text-hearth-text hover:border-hearth-border-strong hover:bg-hearth-chip'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* Key input — shown once provider selected */}
            {provider && (
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-hearth-text">
                    {provider.label}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestStatus('idle');
                    }}
                    placeholder={provider.placeholder}
                    className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 font-mono text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-hearth-text-faint">{provider.hint}</p>
                </div>

                <button
                  type="button"
                  onClick={handleTest}
                  disabled={!canTest || testStatus === 'testing'}
                  className="w-full rounded-lg border border-hearth-border-strong py-2 text-sm font-medium text-hearth-text hover:bg-hearth-chip disabled:opacity-50"
                >
                  {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>

                {testMessage && (
                  <p className={`text-sm ${testStatus === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                    {testStatus === 'ok' ? '✓ ' : '✗ '}{testMessage}
                  </p>
                )}

                {/* Model selection — shown after successful test */}
                {testStatus === 'ok' && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-hearth-text">
                      Default model
                    </label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                    >
                      {MODELS[selectedProvider!].map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {canSave && (
                  <button
                    type="button"
                    onClick={handleSaveLlm}
                    disabled={saving}
                    className="w-full rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--hearth-accent)' }}
                  >
                    {saving ? 'Saving...' : 'Save & Continue'}
                  </button>
                )}
              </div>
            )}

            {/* Skip option */}
            <button
              type="button"
              onClick={() => { setStep('done'); onComplete(); }}
              className="mt-4 w-full text-center text-xs text-hearth-text-faint hover:text-hearth-text-muted"
            >
              Skip for now (configure later in Settings)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
