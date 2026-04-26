import { useState } from 'react';
import type { ToolCallInfo } from '@/hooks/use-chat';
import { HToolPill } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = toolCall.status === 'running';

  return (
    <div className="ml-10">
      <button
        type="button"
        className="flex items-center gap-1.5"
        onClick={() => setExpanded(!expanded)}
      >
        <HToolPill state={isRunning ? 'running' : 'done'}>
          {toolCall.tool}
        </HToolPill>
        <HIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color="var(--hearth-text-faint)" />
      </button>

      {expanded && (
        <div className="mt-2 rounded-md border border-hearth-border bg-hearth-card-alt p-3">
          <div className="mb-1 text-[11px] font-medium text-hearth-text-faint uppercase tracking-wide">Input</div>
          <pre className="overflow-auto rounded-sm bg-hearth-chip p-2 text-xs text-hearth-text font-mono">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.output && (
            <>
              <div className="mb-1 mt-3 text-[11px] font-medium text-hearth-text-faint uppercase tracking-wide">Output</div>
              <pre className="overflow-auto rounded-sm bg-hearth-chip p-2 text-xs text-hearth-text font-mono">
                {JSON.stringify(toolCall.output, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
