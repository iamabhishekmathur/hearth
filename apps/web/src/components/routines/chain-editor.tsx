import { useState } from 'react';
import type { Routine, RoutineChain } from '@hearth/shared';

interface ChainEditorProps {
  routineId: string;
  chainsFrom: (RoutineChain & { targetRoutine?: { id: string; name: string } })[];
  chainsTo: (RoutineChain & { sourceRoutine?: { id: string; name: string } })[];
  availableRoutines: Routine[];
  onCreateChain: (data: { targetRoutineId: string; condition: string; parameterMapping: Record<string, string> }) => Promise<void>;
  onDeleteChain: (chainId: string) => Promise<void>;
}

const CONDITIONS = [
  { value: 'on_success', label: 'On success' },
  { value: 'on_failure', label: 'On failure' },
  { value: 'always', label: 'Always' },
];

export function ChainEditor({ routineId, chainsFrom, chainsTo, availableRoutines, onCreateChain, onDeleteChain }: ChainEditorProps) {
  const [targetId, setTargetId] = useState('');
  const [condition, setCondition] = useState('on_success');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!targetId) return;
    setAdding(true);
    try {
      await onCreateChain({ targetRoutineId: targetId, condition, parameterMapping: {} });
      setTargetId('');
      setCondition('on_success');
    } finally {
      setAdding(false);
    }
  };

  // Filter out self and already-chained routines
  const chainedIds = new Set(chainsFrom.map((c) => c.targetRoutineId));
  const eligible = availableRoutines.filter((r) => r.id !== routineId && !chainedIds.has(r.id));

  return (
    <div className="space-y-3">
      {/* Existing chains FROM this routine */}
      {chainsFrom.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Triggers</p>
          <div className="space-y-1.5">
            {chainsFrom.map((chain) => (
              <div key={chain.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400">→</span>
                  <span className="font-medium text-gray-700">
                    {(chain as { targetRoutine?: { name: string } }).targetRoutine?.name ?? chain.targetRoutineId.slice(0, 8)}
                  </span>
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                    {chain.condition.replace('_', ' ')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteChain(chain.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chains TO this routine */}
      {chainsTo.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Triggered by</p>
          <div className="space-y-1.5">
            {chainsTo.map((chain) => (
              <div key={chain.id} className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm">
                <span className="text-blue-400">←</span>
                <span className="font-medium text-blue-700">
                  {(chain as { sourceRoutine?: { name: string } }).sourceRoutine?.name ?? chain.sourceRoutineId.slice(0, 8)}
                </span>
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600">
                  {chain.condition.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add new chain */}
      {eligible.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600">Then trigger</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
            >
              <option value="">Select routine...</option>
              {eligible.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!targetId || adding}
            className="rounded-lg bg-hearth-600 px-3 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
          >
            {adding ? '...' : 'Add'}
          </button>
        </div>
      )}

      {chainsFrom.length === 0 && chainsTo.length === 0 && eligible.length === 0 && (
        <p className="text-xs text-gray-400">No other routines available to chain with.</p>
      )}
    </div>
  );
}
