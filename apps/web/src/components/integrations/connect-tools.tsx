import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api-client';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics-events';
import { FadeIn } from '@/components/ui/motion';
import { HButton, HBadge } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';

/**
 * Member-facing "Connect a tool" surface.
 *
 * Unlike the admin Integration Health panel (org-scoped, requireRole admin),
 * this talks to the per-user API at /api/v1/integrations: any member can connect
 * their OWN Slack/Gmail/Granola/custom-MCP, see their connected tools with
 * health, and disconnect them. Connecting is the activation aha — the server
 * runs an on-connect backfill and completes the connect_integration onboarding
 * step keyed off the connecting user. On a successful connect we fire a
 * `hearth:onboarding-refresh` event so the checklist tick appears without
 * needing a tab refocus.
 */

interface MyIntegration {
  id: string;
  provider: string;
  status: string;
  enabled: boolean;
  healthCheckedAt: string | null;
  /** Present on org-level integrations the member did not connect themselves. */
  scope?: 'user' | 'org';
  label?: string | null;
}

interface HealthResult {
  status: string;
  healthCheckedAt: string | null;
}

// ─── Provider Catalog (the providers a member can connect for themselves) ─────

interface ProviderInfo {
  provider: string;
  label: string;
  description: string;
  glyph: string;
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
    description: 'Pull in the threads and channels you are part of.',
    glyph: '#',
    credentials: [
      { key: 'bot_token', label: 'User Token', placeholder: 'xoxp-…', secret: true },
    ],
  },
  {
    provider: 'gmail',
    label: 'Gmail',
    description: 'Surface tasks and context from your inbox.',
    glyph: 'M',
    credentials: [
      { key: 'access_token', label: 'Access Token', placeholder: 'ya29…', secret: true },
    ],
  },
  {
    provider: 'granola',
    label: 'Granola',
    description: 'Bring your meeting notes and action items into memory.',
    glyph: 'G',
    credentials: [
      { key: 'api_key', label: 'API Key', placeholder: 'gra_…', secret: true },
    ],
  },
];

const CATALOG_BY_PROVIDER = new Map(PROVIDER_CATALOG.map((p) => [p.provider, p]));

function providerLabel(provider: string, label?: string | null): string {
  if (label) return label;
  const c = CATALOG_BY_PROVIDER.get(provider);
  if (c) return c.label;
  if (provider === 'custom') return 'Custom MCP Server';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function providerGlyph(provider: string): string {
  const c = CATALOG_BY_PROVIDER.get(provider);
  if (c) return c.glyph;
  if (provider === 'custom') return '{}';
  return provider.charAt(0).toUpperCase();
}

type StatusTone = 'ok' | 'warn' | 'err' | 'neutral';
function statusTone(status: string, enabled: boolean): { tone: StatusTone; label: string } {
  if (!enabled) return { tone: 'neutral', label: 'Disabled' };
  switch (status) {
    case 'active':
      return { tone: 'ok', label: 'Healthy' };
    case 'error':
      return { tone: 'err', label: 'Error' };
    default:
      return { tone: 'warn', label: status || 'Pending' };
  }
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ConnectTools() {
  const [integrations, setIntegrations] = useState<MyIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null); // provider key or 'custom'

  const fetchMine = useCallback(() => {
    api
      .get<{ data: MyIntegration[] }>('/integrations')
      .then((res) => setIntegrations(res.data ?? []))
      .catch(() => setIntegrations([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchMine();
  }, [fetchMine]);

  const handleConnected = useCallback(() => {
    setSelected(null);
    fetchMine();
    // Nudge the onboarding surface to re-pull so connect_integration ticks
    // (the server already completed the step + fired INTEGRATION_CONNECTED).
    window.dispatchEvent(new CustomEvent('hearth:onboarding-refresh'));
  }, [fetchMine]);

  const connectedProviders = useMemo(
    () => new Set(integrations.filter((i) => i.scope !== 'org').map((i) => i.provider)),
    [integrations],
  );

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col overflow-y-auto px-6 py-8">
      <FadeIn>
        <header className="mb-7">
          <div className="flex items-center gap-2">
            <HIcon name="link" size={18} color="var(--hearth-accent)" />
            <h1
              className="font-display font-semibold text-hearth-text"
              style={{ fontSize: 22, letterSpacing: -0.4 }}
            >
              Connect a tool
            </h1>
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-hearth-text-muted">
            Connect your own Slack, Gmail, or Granola and Hearth pulls your tasks and
            context into memory automatically. These connections are yours — only you
            can see and use them.
          </p>
        </header>
      </FadeIn>

      {/* Provider catalog */}
      <FadeIn delay={60}>
        <section className="mb-9">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-hearth-text-faint">
            Connect
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {PROVIDER_CATALOG.map((p) => {
              const already = connectedProviders.has(p.provider);
              return (
                <button
                  key={p.provider}
                  type="button"
                  disabled={already}
                  onClick={() => setSelected(p.provider)}
                  className="group flex items-start gap-3 rounded-lg border border-hearth-border bg-hearth-card p-3.5 text-left transition-all duration-fast ease-hearth hover:border-hearth-accent disabled:cursor-default disabled:opacity-55 disabled:hover:border-hearth-border"
                >
                  <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-hearth-chip text-sm font-bold text-hearth-text">
                    {p.glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-hearth-text">{p.label}</span>
                      {already && <HBadge tone="ok">Connected</HBadge>}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-snug text-hearth-text-muted">
                      {p.description}
                    </p>
                  </div>
                  {!already && (
                    <HIcon name="plus" size={16} color="var(--hearth-text-faint)" />
                  )}
                </button>
              );
            })}
            {/* Custom MCP */}
            <button
              type="button"
              onClick={() => setSelected('custom')}
              className="group flex items-start gap-3 rounded-lg border border-dashed border-hearth-border-strong p-3.5 text-left transition-all duration-fast ease-hearth hover:border-hearth-accent"
            >
              <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-hearth-chip font-mono text-xs font-bold text-hearth-text-muted">
                {'{}'}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[13.5px] font-semibold text-hearth-text">Custom MCP Server</span>
                <p className="mt-0.5 text-[12px] leading-snug text-hearth-text-muted">
                  Connect any MCP-compatible server by URL.
                </p>
              </div>
              <HIcon name="arrow-right" size={16} color="var(--hearth-text-faint)" />
            </button>
          </div>
        </section>
      </FadeIn>

      {/* My connected tools */}
      <FadeIn delay={120}>
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-hearth-text-faint">
            Your connected tools
          </h2>
          {loading ? (
            <p className="text-[13px] text-hearth-text-faint">Loading…</p>
          ) : integrations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hearth-border-strong px-4 py-9 text-center">
              <p className="text-[13px] font-medium text-hearth-text-muted">
                Nothing connected yet
              </p>
              <p className="mt-1 text-[12px] text-hearth-text-faint">
                Connect a tool above to pull your tasks and context into Hearth.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {integrations.map((integ) => (
                <ConnectedRow key={integ.id} integ={integ} onChanged={fetchMine} />
              ))}
            </ul>
          )}
        </section>
      </FadeIn>

      {selected && (
        <ConnectModal
          providerKey={selected}
          onClose={() => setSelected(null)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}

// ─── Connected row (health re-check + disconnect) ─────────────────────────────

function ConnectedRow({ integ, onChanged }: { integ: MyIntegration; onChanged: () => void }) {
  const [checking, setChecking] = useState(false);
  const [live, setLive] = useState<{ status: string; healthCheckedAt: string | null }>({
    status: integ.status,
    healthCheckedAt: integ.healthCheckedAt,
  });
  const isOrg = integ.scope === 'org';
  const { tone, label } = statusTone(live.status, integ.enabled);

  const recheck = async () => {
    setChecking(true);
    try {
      const res = await api.get<{ data: HealthResult }>(`/integrations/${integ.id}/health`);
      setLive({ status: res.data.status, healthCheckedAt: res.data.healthCheckedAt });
    } catch {
      setLive((prev) => ({ ...prev, status: 'error' }));
    } finally {
      setChecking(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.delete(`/integrations/${integ.id}`);
      onChanged();
    } catch {
      // leave the row; a transient failure should not blank the list
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-hearth-border bg-hearth-card px-4 py-3">
      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-hearth-chip text-sm font-bold text-hearth-text">
        {providerGlyph(integ.provider)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-hearth-text">
            {providerLabel(integ.provider, integ.label)}
          </span>
          <HBadge tone={tone}>{label}</HBadge>
          {isOrg && <HBadge tone="neutral">Org</HBadge>}
        </div>
        {live.healthCheckedAt && (
          <p className="mt-0.5 text-[11px] text-hearth-text-faint">
            Last checked {new Date(live.healthCheckedAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <HButton variant="ghost" size="sm" onClick={recheck} disabled={checking}>
          {checking ? 'Checking…' : 'Check'}
        </HButton>
        {!isOrg && (
          <HButton variant="ghost" size="sm" onClick={disconnect}>
            Disconnect
          </HButton>
        )}
      </div>
    </li>
  );
}

// ─── Connect modal (credential / custom-URL form) ─────────────────────────────

function ConnectModal({
  providerKey,
  onClose,
  onConnected,
}: {
  providerKey: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const catalog = CATALOG_BY_PROVIDER.get(providerKey) ?? null;
  const isCustom = providerKey === 'custom';

  const [values, setValues] = useState<Record<string, string>>({});
  const [customUrl, setCustomUrl] = useState('');
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);

    let body: Record<string, unknown>;
    if (isCustom) {
      const url = customUrl.trim();
      if (!url) {
        setError('Server URL is required');
        return;
      }
      try {
        new URL(url);
      } catch {
        setError('Enter a valid URL (e.g. https://mcp.example.com)');
        return;
      }
      body = {
        provider: 'custom',
        credentials: { server_url: url },
        serverUrl: url,
        label: customName.trim() || undefined,
      };
    } else if (catalog) {
      const creds: Record<string, string> = {};
      for (const c of catalog.credentials) {
        const v = values[c.key]?.trim();
        if (!v) {
          setError(`${c.label} is required`);
          return;
        }
        creds[c.key] = v;
      }
      body = { provider: catalog.provider, credentials: creds };
    } else {
      return;
    }

    setSaving(true);
    try {
      await api.post('/integrations', body);
      trackEvent(AnalyticsEvent.INTEGRATION_CONNECTED, {
        provider: isCustom ? 'custom' : catalog!.provider,
        kind: isCustom ? 'custom' : 'builtin',
        scope: 'user',
      });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setSaving(false);
    }
  };

  const title = isCustom ? 'Custom MCP Server' : `Connect ${catalog?.label ?? providerKey}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh]">
      <FadeIn variant="scale-in" className="w-full max-w-md">
        <div className="overflow-hidden rounded-xl border border-hearth-border bg-hearth-card shadow-hearth-2">
          <div className="flex items-center justify-between border-b border-hearth-border px-5 py-3.5">
            <h2 className="font-display text-[16px] font-semibold text-hearth-text" style={{ letterSpacing: -0.2 }}>
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded p-1 text-hearth-text-faint transition-colors hover:text-hearth-text"
            >
              <HIcon name="x" size={16} />
            </button>
          </div>

          <div className="space-y-3.5 px-5 py-4">
            {isCustom ? (
              <>
                <Field label="Server URL">
                  <input
                    type="url"
                    autoFocus
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://mcp.example.com/sse"
                    className={inputClass}
                  />
                </Field>
                <Field label="Display name (optional)">
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="My Custom Server"
                    className={inputClass}
                  />
                </Field>
              </>
            ) : (
              catalog?.credentials.map((c, i) => (
                <Field key={c.key} label={c.label}>
                  <input
                    type={c.secret ? 'password' : 'text'}
                    autoFocus={i === 0}
                    value={values[c.key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [c.key]: e.target.value }))}
                    placeholder={c.placeholder}
                    className={`${inputClass} font-mono`}
                  />
                </Field>
              ))
            )}

            {error && <p className="text-[12px] text-hearth-err">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-hearth-border px-5 py-3">
            <HButton variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </HButton>
            <HButton variant="accent" size="sm" onClick={submit} disabled={saving} iconRight="arrow-right">
              {saving ? 'Connecting…' : 'Connect'}
            </HButton>
          </div>
        </div>
      </FadeIn>
    </div>
  );
}

const inputClass =
  'block w-full rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-2 text-[13.5px] text-hearth-text outline-none transition-all duration-fast ease-hearth placeholder:text-hearth-text-faint focus:border-hearth-accent focus:shadow-hearth-focus';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-hearth-text-muted">{label}</span>
      {children}
    </label>
  );
}
