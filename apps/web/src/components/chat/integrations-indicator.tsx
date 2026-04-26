import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { ApiResponse } from '@hearth/shared';

const INTEGRATION_COLORS: Record<string, string> = {
  slack: 'bg-purple-400',
  gmail: 'bg-red-400',
  jira: 'bg-blue-400',
  github: 'bg-hearth-text',
  notion: 'bg-hearth-text',
  'google-calendar': 'bg-green-400',
  'google-drive': 'bg-yellow-400',
};

export function IntegrationsIndicator() {
  const [integrations, setIntegrations] = useState<string[]>([]);

  useEffect(() => {
    api
      .get<ApiResponse<string[]>>('/chat/integrations/active')
      .then((res) => {
        if (res.data) setIntegrations(res.data);
      })
      .catch(() => {});
  }, []);

  if (integrations.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {integrations.map((id) => (
        <span
          key={id}
          title={id}
          className={`h-2 w-2 rounded-full ${INTEGRATION_COLORS[id] ?? 'bg-hearth-text-faint'}`}
        />
      ))}
      <span className="ml-0.5 text-[10px] text-hearth-text-faint">
        {integrations.length} connected
      </span>
    </div>
  );
}
