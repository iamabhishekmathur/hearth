import { useMemo } from 'react';
import type { IntegrationInfo } from './mention-textarea';
import { getProviderMeta } from './mention-textarea';

interface IntegrationActionsProps {
  prompt: string;
  connectedIntegrations: IntegrationInfo[];
}

// Known provider labels for detecting unconnected mentions
const KNOWN_PROVIDERS: Record<string, string> = {
  slack: 'Slack',
  github: 'GitHub',
  notion: 'Notion',
  jira: 'Jira',
  gmail: 'Gmail',
  'google drive': 'Google Drive',
  'google calendar': 'Google Calendar',
};

interface ToolCall {
  name: string;
  humanName: string;
  description: string;
  resourceParams: Array<{ name: string; description: string }>;
}

interface ResolvedIntegration {
  label: string;
  provider: string;
  connected: boolean;
  tools: ToolCall[];
}

/**
 * Parses @mentions from the prompt and resolves them against connected integrations.
 * Returns both connected and unconnected integrations referenced in the prompt.
 */
function resolveIntegrations(
  prompt: string,
  connected: IntegrationInfo[],
): ResolvedIntegration[] {
  // Extract @Mentions — match @Word or @Two Words (up to 2 words for "Google Calendar" etc.)
  const mentionPattern = /@([\w]+(?:\s[\w]+)?)/g;
  const mentions = new Map<string, string>(); // lowercase → original
  let match;
  while ((match = mentionPattern.exec(prompt)) !== null) {
    const raw = match[1].trim();
    mentions.set(raw.toLowerCase(), raw);
  }

  if (mentions.size === 0) return [];

  const connectedByLabel = new Map(
    connected.map((i) => [i.label.toLowerCase(), i]),
  );

  const result: ResolvedIntegration[] = [];
  const seen = new Set<string>();

  for (const [lower] of mentions) {
    if (seen.has(lower)) continue;
    seen.add(lower);

    const integ = connectedByLabel.get(lower);
    if (integ) {
      result.push({
        label: integ.label,
        provider: integ.provider,
        connected: true,
        tools: integ.tools.map((t) => ({
          name: t.name,
          humanName: humanToolName(t.name),
          description: t.description,
          resourceParams: t.resourceParams,
        })),
      });
    } else if (KNOWN_PROVIDERS[lower]) {
      result.push({
        label: KNOWN_PROVIDERS[lower],
        provider: lower.replace(/\s/g, ''),
        connected: false,
        tools: [],
      });
    }
    // Ignore unknown @mentions — could be regular text
  }

  return result;
}

export function IntegrationActions({ prompt, connectedIntegrations }: IntegrationActionsProps) {
  const integrations = useMemo(
    () => resolveIntegrations(prompt, connectedIntegrations),
    [prompt, connectedIntegrations],
  );

  if (integrations.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Integrations & Tool Calls
        </h4>
      </div>
      <div className="divide-y divide-gray-100">
        {integrations.map((integ) => {
          const meta = getProviderMeta(integ.provider);
          return (
            <div key={integ.label} className="px-4 py-3">
              {/* Integration header */}
              <div className="flex items-center gap-2.5">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${meta.bg} ${meta.color}`}>
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{integ.label}</span>
                    {integ.connected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        Not connected
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Tool calls */}
              {integ.connected && integ.tools.length > 0 && (
                <div className="ml-9 mt-2.5 space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                    Tool calls
                  </p>
                  {integ.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-md border border-gray-150 bg-gray-50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] font-semibold text-gray-800">
                          {tool.name}
                        </code>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                        {tool.description}
                      </p>
                      {tool.resourceParams.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {tool.resourceParams.map((p) => (
                            <span
                              key={p.name}
                              title={p.description}
                              className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                            >
                              <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M8.47 1.318a1 1 0 0 0-.94 0l-6 3.2A1 1 0 0 0 1 5.4v.817l5.75 3.45L8 8.917l1.25.75L15 6.217V5.4a1 1 0 0 0-.53-.882l-6-3.2ZM15 7.883l-4.778 2.867L15 13.117V7.883Zm-.035 6.88L8 10.583l-6.965 4.18A1 1 0 0 0 1.53 15.4l6 3.2a1 1 0 0 0 .94 0l6-3.2a1 1 0 0 0 .495-.637ZM1 13.117l4.778-2.867L1 7.883v5.234Z" />
                              </svg>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Not connected message */}
              {!integ.connected && (
                <p className="ml-9 mt-1.5 text-xs text-red-600">
                  Ask your admin to connect {integ.label} in Settings &rarr; Integrations
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function humanToolName(name: string): string {
  const parts = name.split('_');
  const withoutProvider = parts.length > 1 ? parts.slice(1).join(' ') : name;
  return withoutProvider.charAt(0).toUpperCase() + withoutProvider.slice(1);
}
