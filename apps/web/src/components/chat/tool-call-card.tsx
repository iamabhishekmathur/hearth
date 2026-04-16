import { useState } from 'react';
import type { ToolCallInfo } from '@/hooks/use-chat';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = toolCall.status === 'running';

  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-sm shadow-sm">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100"
          onClick={() => setExpanded(!expanded)}
        >
          {isRunning ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-hearth-400 border-t-transparent" />
          ) : (
            <span className="text-green-600">&#10003;</span>
          )}
          <span className="font-mono text-xs font-medium text-gray-700">
            {toolCall.tool}
          </span>
          <span className="ml-auto text-xs text-gray-400">
            {expanded ? '\u25B2' : '\u25BC'}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-gray-200 px-3 py-2">
            <div className="mb-1 text-xs font-medium text-gray-500">Input</div>
            <pre className="overflow-auto rounded bg-gray-100 p-2 text-xs text-gray-700">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
            {toolCall.output && (
              <>
                <div className="mb-1 mt-2 text-xs font-medium text-gray-500">
                  Output
                </div>
                <pre className="overflow-auto rounded bg-gray-100 p-2 text-xs text-gray-700">
                  {JSON.stringify(toolCall.output, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
