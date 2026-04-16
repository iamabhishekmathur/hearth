import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api-client';

interface Integration {
  id: string;
  provider: string;
  status: string;
  enabled: boolean;
  healthCheckedAt: string | null;
}

// ─── Provider Catalog ───────────────────────────────────────────────────────

interface ProviderInfo {
  provider: string;
  label: string;
  description: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  credentials: Array<{
    key: string;
    label: string;
    placeholder: string;
    secret?: boolean;
  }>;
}

const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    provider: 'slack',
    label: 'Slack',
    description: 'Post messages, search conversations, and list channels.',
    icon: '#',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-700',
    credentials: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-...', secret: true },
    ],
  },
  {
    provider: 'github',
    label: 'GitHub',
    description: 'List repos, pull requests, issues, and create comments.',
    icon: 'GH',
    iconBg: 'bg-gray-200',
    iconColor: 'text-gray-800',
    credentials: [
      { key: 'access_token', label: 'Personal Access Token', placeholder: 'ghp_...', secret: true },
    ],
  },
  {
    provider: 'notion',
    label: 'Notion',
    description: 'Search pages, query databases, and create content.',
    icon: 'N',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-900',
    credentials: [
      { key: 'api_key', label: 'Integration Token', placeholder: 'ntn_...', secret: true },
    ],
  },
  {
    provider: 'gcalendar',
    label: 'Google Calendar',
    description: 'List events, check availability, and create calendar entries.',
    icon: 'C',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-700',
    credentials: [
      { key: 'access_token', label: 'Access Token', placeholder: 'ya29...', secret: true },
    ],
  },
  {
    provider: 'gmail',
    label: 'Gmail',
    description: 'Search emails, read threads, and draft messages.',
    icon: 'M',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-700',
    credentials: [
      { key: 'access_token', label: 'Access Token', placeholder: 'ya29...', secret: true },
    ],
  },
  {
    provider: 'gdrive',
    label: 'Google Drive',
    description: 'Search files, read documents, and manage folders.',
    icon: 'D',
    iconBg: 'bg-green-100',
    iconColor: 'text-green-700',
    credentials: [
      { key: 'access_token', label: 'Access Token', placeholder: 'ya29...', secret: true },
    ],
  },
  {
    provider: 'jira',
    label: 'Jira',
    description: 'Search issues, create tickets, and manage sprints.',
    icon: 'J',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-700',
    credentials: [
      { key: 'domain', label: 'Jira Domain', placeholder: 'yourteam.atlassian.net' },
      { key: 'email', label: 'Email', placeholder: 'you@company.com' },
      { key: 'api_token', label: 'API Token', placeholder: 'ATATT3x...', secret: true },
    ],
  },
];

const CATALOG_BY_PROVIDER = new Map(PROVIDER_CATALOG.map((p) => [p.provider, p]));

function getProviderDisplay(provider: string) {
  const catalog = CATALOG_BY_PROVIDER.get(provider);
  if (catalog) return catalog;
  // Custom MCP servers
  return {
    label: provider === 'custom' ? 'Custom MCP Server' : provider,
    icon: provider === 'custom' ? '{}' : provider.charAt(0).toUpperCase(),
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-700',
  };
}

const STATUS_BADGE: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  active: { bg: 'bg-green-50', dot: 'bg-green-500', text: 'text-green-700', label: 'Active' },
  inactive: { bg: 'bg-gray-50', dot: 'bg-gray-400', text: 'text-gray-600', label: 'Disabled' },
  error: { bg: 'bg-red-50', dot: 'bg-red-500', text: 'text-red-700', label: 'Error' },
};

// ─── Main Component ─────────────────────────────────────────────────────────

export function IntegrationHealth() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDirectory, setShowDirectory] = useState(false);

  const fetchIntegrations = useCallback(() => {
    api.get<{ data: Integration[] }>('/admin/integrations')
      .then((res) => setIntegrations(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const handleToggle = async (integ: Integration) => {
    try {
      await api.patch(`/admin/integrations/${integ.id}`, { enabled: !integ.enabled });
      fetchIntegrations();
    } catch {
      // ignore
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await api.delete(`/admin/integrations/${id}`);
      fetchIntegrations();
    } catch {
      // ignore
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading integrations...</p>;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Integrations</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Connect external services so routines and the AI agent can read and write to them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDirectory(true)}
          className="flex items-center gap-1.5 rounded-lg bg-hearth-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-hearth-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Integration
        </button>
      </div>

      {/* Connected integrations */}
      {integrations.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.914-3.814a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 0 6.364 6.364l-1.757 1.757" />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-600">No integrations connected</p>
          <p className="mt-1 text-xs text-gray-400">
            Add an integration to enable your AI agent to work with external tools.
          </p>
          <button
            type="button"
            onClick={() => setShowDirectory(true)}
            className="mt-4 rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700"
          >
            Browse Integrations
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {integrations.map((integ) => {
            const display = getProviderDisplay(integ.provider);
            const badge = STATUS_BADGE[integ.status] ?? STATUS_BADGE.inactive;
            return (
              <div
                key={integ.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${display.iconBg} ${display.iconColor}`}>
                  {display.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{display.label}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badge.bg} ${badge.text} ring-current/20`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                      {badge.label}
                    </span>
                  </div>
                  {integ.healthCheckedAt && (
                    <p className="text-[11px] text-gray-400">
                      Last checked {new Date(integ.healthCheckedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggle(integ)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${integ.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                    aria-label={integ.enabled ? 'Disable' : 'Enable'}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${integ.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisconnect(integ.id)}
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Directory modal */}
      {showDirectory && (
        <IntegrationDirectory
          connectedProviders={new Set(integrations.map((i) => i.provider))}
          onClose={() => setShowDirectory(false)}
          onConnected={() => {
            fetchIntegrations();
            setShowDirectory(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Directory Modal ────────────────────────────────────────────────────────

interface DirectoryProps {
  connectedProviders: Set<string>;
  onClose: () => void;
  onConnected: () => void;
}

function IntegrationDirectory({ connectedProviders, onClose, onConnected }: DirectoryProps) {
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [customUrl, setCustomUrl] = useState('');
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);

  const available = useMemo(() => {
    let list = PROVIDER_CATALOG.filter((p) => !connectedProviders.has(p.provider));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [connectedProviders, search]);

  const selectedCatalog = selectedProvider
    ? PROVIDER_CATALOG.find((p) => p.provider === selectedProvider)
    : null;

  const handleConnectBuiltin = async () => {
    if (!selectedCatalog) return;

    const creds: Record<string, string> = {};
    for (const c of selectedCatalog.credentials) {
      const val = credentialValues[c.key]?.trim();
      if (!val) {
        setError(`${c.label} is required`);
        return;
      }
      creds[c.key] = val;
    }

    setSaving(true);
    setError(null);
    try {
      await api.post('/admin/integrations', {
        provider: selectedCatalog.provider,
        credentials: creds,
      });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setSaving(false);
    }
  };

  const handleConnectCustom = async () => {
    if (!customUrl.trim()) {
      setError('Server URL is required');
      return;
    }
    try {
      new URL(customUrl.trim());
    } catch {
      setError('Enter a valid URL (e.g., https://mcp.example.com)');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.post('/admin/integrations', {
        provider: 'custom',
        credentials: { server_url: customUrl.trim() },
        serverUrl: customUrl.trim(),
        label: customName.trim() || undefined,
      });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]">
      <div className="relative flex max-h-[75vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add Integration</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Connect a service or add a custom MCP server
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-gray-200 px-6 py-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search integrations..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
            />
          </div>
        </div>

        {/* Body — either catalog grid or credential form */}
        <div className="flex-1 overflow-y-auto">
          {selectedCatalog ? (
            /* ── Credential form for selected provider ── */
            <div className="p-6">
              <button
                type="button"
                onClick={() => {
                  setSelectedProvider(null);
                  setCredentialValues({});
                  setError(null);
                }}
                className="mb-4 flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
                </svg>
                Back to directory
              </button>

              <div className="flex items-center gap-3 mb-5">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${selectedCatalog.iconBg} ${selectedCatalog.iconColor}`}>
                  {selectedCatalog.icon}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Connect {selectedCatalog.label}</h3>
                  <p className="text-xs text-gray-500">{selectedCatalog.description}</p>
                </div>
              </div>

              <div className="space-y-3">
                {selectedCatalog.credentials.map((cred) => (
                  <div key={cred.key}>
                    <label className="block text-xs font-medium text-gray-700">{cred.label}</label>
                    <input
                      type={cred.secret ? 'password' : 'text'}
                      value={credentialValues[cred.key] ?? ''}
                      onChange={(e) =>
                        setCredentialValues((prev) => ({ ...prev, [cred.key]: e.target.value }))
                      }
                      placeholder={cred.placeholder}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                    />
                  </div>
                ))}
              </div>

              {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={handleConnectBuiltin}
                  disabled={saving}
                  className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
                >
                  {saving ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProvider(null);
                    setError(null);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : showCustom ? (
            /* ── Custom MCP Server form ── */
            <div className="p-6">
              <button
                type="button"
                onClick={() => {
                  setShowCustom(false);
                  setError(null);
                }}
                className="mb-4 flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
                </svg>
                Back to directory
              </button>

              <div className="flex items-center gap-3 mb-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 font-mono text-xs font-bold text-gray-700">
                  {'{}'}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Custom MCP Server</h3>
                  <p className="text-xs text-gray-500">Connect any MCP-compatible server by URL</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Server URL</label>
                  <input
                    type="url"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://mcp.example.com/sse"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    The HTTP endpoint of the MCP server (supports JSON-RPC over HTTP)
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">
                    Display Name <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="My Custom Server"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                  />
                </div>
              </div>

              {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={handleConnectCustom}
                  disabled={saving}
                  className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
                >
                  {saving ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustom(false);
                    setError(null);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* ── Directory grid ── */
            <div className="p-6">
              {/* Popular / built-in connectors */}
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Popular
              </h4>
              {available.length === 0 && !search ? (
                <p className="text-xs text-gray-400">All built-in integrations are already connected.</p>
              ) : available.length === 0 ? (
                <p className="text-xs text-gray-400">No integrations match &quot;{search}&quot;</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {available.map((catalog) => {
                    const alreadyConnected = connectedProviders.has(catalog.provider);
                    return (
                      <button
                        key={catalog.provider}
                        type="button"
                        disabled={alreadyConnected}
                        onClick={() => {
                          setSelectedProvider(catalog.provider);
                          setCredentialValues({});
                          setError(null);
                        }}
                        className="group flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-left transition-all hover:border-hearth-300 hover:shadow-sm disabled:opacity-50"
                      >
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${catalog.iconBg} ${catalog.iconColor}`}>
                          {catalog.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{catalog.label}</span>
                            {alreadyConnected && (
                              <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                Connected
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{catalog.description}</p>
                        </div>
                        {!alreadyConnected && (
                          <svg className="h-5 w-5 shrink-0 text-gray-300 group-hover:text-hearth-500" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Custom MCP Server */}
              <div className="mt-6 border-t border-gray-100 pt-5">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Custom
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustom(true);
                    setCustomUrl('');
                    setCustomName('');
                    setError(null);
                  }}
                  className="group flex w-full items-center gap-3 rounded-lg border border-dashed border-gray-300 p-3 text-left transition-all hover:border-hearth-300 hover:bg-hearth-50/30"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 font-mono text-xs font-bold text-gray-500 group-hover:bg-hearth-100 group-hover:text-hearth-600">
                    {'{}'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-900">Add Custom MCP Server</span>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Connect any MCP-compatible server by entering its URL
                    </p>
                  </div>
                  <svg className="h-5 w-5 shrink-0 text-gray-300 group-hover:text-hearth-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638l-3.96-4.158a.75.75 0 1 1 1.08-1.04l5.25 5.5a.75.75 0 0 1 0 1.08l-5.25 5.5a.75.75 0 1 1-1.08-1.04l3.96-4.158H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
