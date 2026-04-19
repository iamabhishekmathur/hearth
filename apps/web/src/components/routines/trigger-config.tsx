import { useState, useEffect } from 'react';
import type { WebhookEndpoint } from '@hearth/shared';

interface TriggerConfigProps {
  webhookEndpoints: WebhookEndpoint[];
  value: {
    webhookEndpointId: string;
    eventType: string;
    filters: Record<string, unknown>;
  } | null;
  onChange: (value: TriggerConfigProps['value']) => void;
  apiBaseUrl?: string;
}

const PROVIDER_EVENTS: Record<string, string[]> = {
  github: [
    'push', 'pull_request.*', 'pull_request.opened', 'pull_request.closed',
    'pull_request.merged', 'issues.*', 'issues.opened', 'issues.closed',
    'pull_request_review.*', 'release.*', 'workflow_run.*',
  ],
  jira: [
    'jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted',
    'sprint_started', 'sprint_closed',
  ],
  slack: ['message', 'reaction_added', 'channel_created'],
  notion: ['page.created', 'page.updated', 'database.updated'],
};

export function TriggerConfig({ webhookEndpoints, value, onChange, apiBaseUrl }: TriggerConfigProps) {
  const [selectedEndpoint, setSelectedEndpoint] = useState(value?.webhookEndpointId ?? '');
  const [eventType, setEventType] = useState(value?.eventType ?? '');

  const endpoint = webhookEndpoints.find((e) => e.id === selectedEndpoint);
  const events = endpoint ? (PROVIDER_EVENTS[endpoint.provider] ?? []) : [];

  useEffect(() => {
    if (selectedEndpoint && eventType) {
      onChange({ webhookEndpointId: selectedEndpoint, eventType, filters: value?.filters ?? {} });
    } else {
      onChange(null);
    }
  }, [selectedEndpoint, eventType]);

  const webhookUrl = endpoint
    ? `${apiBaseUrl ?? window.location.origin}/api/v1/webhooks/ingest/${endpoint.urlToken}`
    : null;

  return (
    <div className="space-y-3">
      {/* Endpoint selector */}
      <div>
        <label className="block text-xs font-medium text-gray-600">Webhook Endpoint</label>
        <select
          value={selectedEndpoint}
          onChange={(e) => { setSelectedEndpoint(e.target.value); setEventType(''); }}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
        >
          <option value="">Select an endpoint...</option>
          {webhookEndpoints.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.provider.charAt(0).toUpperCase() + ep.provider.slice(1)} — {ep.urlToken.slice(0, 8)}...
            </option>
          ))}
        </select>
      </div>

      {/* Event type selector */}
      {selectedEndpoint && (
        <div>
          <label className="block text-xs font-medium text-gray-600">Event Type</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          >
            <option value="">Select event type...</option>
            {events.map((evt) => (
              <option key={evt} value={evt}>{evt}</option>
            ))}
            <option value="*">* (all events)</option>
          </select>
        </div>
      )}

      {/* Webhook URL display */}
      {webhookUrl && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="mb-1 text-xs font-medium text-gray-500">Webhook URL</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-xs text-gray-700">{webhookUrl}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(webhookUrl)}
              className="flex-shrink-0 rounded px-2 py-1 text-xs text-hearth-600 hover:bg-hearth-50"
            >
              Copy
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Configure this URL in your {endpoint?.provider} webhook settings.
          </p>
        </div>
      )}
    </div>
  );
}
