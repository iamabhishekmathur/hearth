import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { OrgCognitiveSettings } from '@hearth/shared';

export function CognitiveConfig() {
  const [settings, setSettings] = useState<OrgCognitiveSettings>({ enabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<{ data: OrgCognitiveSettings }>('/admin/cognitive/settings')
      .then((res) => setSettings(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      await api.put('/admin/cognitive/settings', { enabled });
      setSettings({ enabled });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-base font-semibold text-gray-900">Digital Co-Worker</h3>
        <p className="text-sm text-gray-500">
          Build cognitive models from chat conversations so team members can ask
          "How would X think about this?" and get evidence-backed responses.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            Enable cognitive profiles for this organization
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            When enabled, Hearth builds cognitive models from chat conversations. Individual
            users can opt out from their settings. Default: off.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          disabled={saving}
          onClick={() => handleToggle(!settings.enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
            settings.enabled ? 'bg-hearth-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              settings.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {saved && <p className="text-sm text-green-600">{'\u2713'} Settings saved</p>}

      {settings.enabled && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            <strong>How it works:</strong> After each qualifying chat session, Hearth extracts
            thought patterns — observations about how the user reasons, decides, and communicates.
            Team members can then type <code className="rounded bg-blue-100 px-1">@name</code> in
            chat to query someone's cognitive model and get a perspective-grounded response.
          </p>
          <p className="mt-2 text-xs text-blue-600">
            All cognitive queries are logged in the audit trail. Users can opt out individually from
            their Settings page.
          </p>
        </div>
      )}
    </div>
  );
}
