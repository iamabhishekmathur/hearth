import { useMemo } from 'react';
import type { IntegrationInfo } from './mention-textarea';

interface PromptRequirementsProps {
  prompt: string;
  integrations: IntegrationInfo[];
}

interface Requirement {
  type: 'warning';
  message: string;
}

/**
 * Parses @mentions in the prompt and checks for missing resource specificity.
 * Only shows warnings — connection status is handled by IntegrationActions.
 */
export function PromptRequirements({ prompt, integrations }: PromptRequirementsProps) {
  const warnings = useMemo(() => {
    const reqs: Requirement[] = [];
    if (!prompt.trim()) return reqs;

    const connectedByLabel = new Map(
      integrations.map((i) => [i.label.toLowerCase(), i]),
    );

    // Find all @Mentions
    const mentionPattern = /@([\w]+(?:\s[\w]+)?)/g;
    let match;
    while ((match = mentionPattern.exec(prompt)) !== null) {
      const label = match[1].trim().toLowerCase();
      const integ = connectedByLabel.get(label);
      if (!integ) continue;

      // Check resource specificity for each tool
      for (const tool of integ.tools) {
        for (const param of tool.resourceParams) {
          if (!checkResourceSpecified(prompt, integ.label, param.name)) {
            reqs.push({
              type: 'warning',
              message: `Specify which ${param.description.toLowerCase()} for ${integ.label} (e.g., ${getExample(param.name)})`,
            });
            break;
          }
        }
      }
    }

    // De-duplicate
    const seen = new Set<string>();
    return reqs.filter((r) => {
      if (seen.has(r.message)) return false;
      seen.add(r.message);
      return true;
    });
  }, [prompt, integrations]);

  if (warnings.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-amber-600">
        Tip: be specific
      </p>
      {warnings.map((r, i) => (
        <p key={i} className="text-xs text-amber-700">
          {r.message}
        </p>
      ))}
    </div>
  );
}

function getExample(paramName: string): string {
  const examples: Record<string, string> = {
    channel: '#team-updates',
    repo: 'acme/webapp',
    owner: 'acme',
    project: 'project "Backend"',
    database_id: 'the "Meeting Notes" database',
    page_id: 'page "Roadmap"',
  };
  return examples[paramName] ?? paramName;
}

function checkResourceSpecified(prompt: string, label: string, paramName: string): boolean {
  const lower = prompt.toLowerCase();
  const idx = lower.indexOf(`@${label.toLowerCase()}`);
  if (idx === -1) return false;

  const context = lower.slice(idx, idx + 120);

  switch (paramName) {
    case 'channel':
      return /#[\w-]+/.test(context) || /channel\s+[\w"']/.test(context);
    case 'repo':
    case 'owner':
      return /[\w-]+\/[\w-]+/.test(context) || /repo|repository/.test(context);
    case 'project':
      return /project\s+[\w"']/.test(context);
    case 'database_id':
    case 'page_id':
      return /database|page|"[^"]+"|'[^']+'/.test(context);
    default:
      return true;
  }
}
