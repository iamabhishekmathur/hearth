import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface TestRunPanelProps {
  prompt: string;
}

interface TestResult {
  status: 'success' | 'failed' | 'timeout';
  output: string | null;
  error: string | null;
  durationMs: number | null;
}

export function TestRunPanel({ prompt }: TestRunPanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const handleTest = useCallback(async () => {
    if (!prompt.trim()) return;
    setRunning(true);
    setResult(null);

    try {
      const res = await api.post<{ data: TestResult }>('/routines/test-run', {
        prompt: prompt.trim(),
      });
      setResult(res.data ?? null);
    } catch (err) {
      setResult({
        status: 'failed',
        output: null,
        error: err instanceof Error ? err.message : 'Test run failed',
        durationMs: null,
      });
    } finally {
      setRunning(false);
    }
  }, [prompt]);

  return (
    <div className="rounded-lg border border-hearth-border bg-hearth-bg animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hearth-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-hearth-text-muted" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6.3 2.841A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.269l9.344-5.89a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium text-hearth-text">Test Run</span>
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={running || !prompt.trim()}
          className="rounded-md bg-hearth-600 px-3 py-1 text-xs font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          {running ? (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
              Running...
            </span>
          ) : (
            'Run Test'
          )}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="px-4 py-3">
          {/* Status badge */}
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                result.status === 'success'
                  ? 'bg-green-50 text-green-700 ring-green-600/20'
                  : result.status === 'timeout'
                    ? 'bg-yellow-50 text-yellow-700 ring-yellow-600/20'
                    : 'bg-red-50 text-red-700 ring-red-600/20'
              }`}
            >
              {result.status}
            </span>
            {result.durationMs != null && (
              <span className="text-xs text-hearth-text-faint">
                {result.durationMs < 1000
                  ? `${result.durationMs}ms`
                  : `${(result.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>

          {/* Output */}
          {result.output && (
            <div className="max-h-60 overflow-y-auto rounded-md border border-hearth-border bg-hearth-card p-3">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-hearth-text">
                {result.output}
              </pre>
            </div>
          )}

          {/* Error */}
          {result.error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-xs text-red-700">{result.error}</p>
            </div>
          )}

          {/* No output */}
          {!result.output && !result.error && result.status === 'success' && (
            <p className="text-xs text-hearth-text-faint">Routine completed with no output.</p>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !running && (
        <div className="px-4 py-3">
          <p className="text-xs text-hearth-text-faint">
            Run a test to verify your prompt works as expected. This executes the prompt once without scheduling it.
          </p>
        </div>
      )}
    </div>
  );
}
