import { useState } from 'react';
import { api } from '@/lib/api-client';
import type { Decision } from '@hearth/shared';

interface Props {
  decision: Decision;
  onClose: () => void;
}

export function DecisionDetailPanel({ decision, onClose }: Props) {
  const [outcomeForm, setOutcomeForm] = useState(false);
  const [verdict, setVerdict] = useState('positive');
  const [outcomeDesc, setOutcomeDesc] = useState('');

  const handleRecordOutcome = async () => {
    await api.post(`/decisions/${decision.id}/outcomes`, {
      verdict,
      description: outcomeDesc,
    });
    setOutcomeForm(false);
    setOutcomeDesc('');
  };

  return (
    <div className="w-2/5 overflow-y-auto border-l border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{decision.title}</h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Metadata */}
      <div className="mt-4 flex flex-wrap gap-2">
        {decision.domain && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{decision.domain}</span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          decision.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
        }`}>{decision.status}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{decision.confidence} confidence</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{decision.source}</span>
      </div>

      {/* Reasoning */}
      <div className="mt-5">
        <h3 className="text-sm font-medium text-gray-700">Reasoning</h3>
        <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">{decision.reasoning}</p>
      </div>

      {/* Description */}
      {decision.description && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">Description</h3>
          <p className="mt-1 text-sm text-gray-600">{decision.description}</p>
        </div>
      )}

      {/* Alternatives */}
      {decision.alternatives && decision.alternatives.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">Alternatives Considered</h3>
          <div className="mt-2 space-y-2">
            {decision.alternatives.map((alt, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-800">{alt.label}</p>
                {alt.pros && <p className="mt-1 text-xs text-green-600">Pros: {alt.pros}</p>}
                {alt.cons && <p className="mt-0.5 text-xs text-red-600">Cons: {alt.cons}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Participants */}
      {decision.participants.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">Participants</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {decision.participants.map((p, i) => (
              <span key={i} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{p}</span>
            ))}
          </div>
        </div>
      )}

      {/* Outcomes */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Outcomes</h3>
          <button type="button" onClick={() => setOutcomeForm(!outcomeForm)} className="text-xs text-hearth-600 hover:text-hearth-700">
            + Record Outcome
          </button>
        </div>
        {outcomeForm && (
          <div className="mt-2 rounded-lg border border-gray-200 p-3">
            <select value={verdict} onChange={e => setVerdict(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="mixed">Mixed</option>
              <option value="neutral">Neutral</option>
              <option value="too_early">Too Early</option>
            </select>
            <textarea
              value={outcomeDesc}
              onChange={e => setOutcomeDesc(e.target.value)}
              placeholder="Describe the outcome..."
              rows={2}
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <button type="button" onClick={handleRecordOutcome} disabled={!outcomeDesc} className="mt-2 rounded bg-hearth-600 px-3 py-1 text-xs text-white hover:bg-hearth-700 disabled:opacity-50">
              Save
            </button>
          </div>
        )}
        {(decision as any).outcomes?.map((o: any) => (
          <div key={o.id} className="mt-2 rounded-lg border border-gray-200 p-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                o.verdict === 'positive' ? 'bg-green-100 text-green-700' :
                o.verdict === 'negative' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700'
              }`}>{o.verdict}</span>
              <span className="text-xs text-gray-400">{o.observedByName ?? 'Unknown'}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{o.description}</p>
          </div>
        ))}
      </div>

      {/* Links */}
      {(decision as any).links?.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-gray-700">Related Decisions</h3>
          <div className="mt-2 space-y-1">
            {(decision as any).links.map((l: any) => (
              <a key={l.id} href={`#/decisions?id=${l.linkedDecision?.id}`} className="block rounded-lg border border-gray-200 p-2 text-sm hover:bg-gray-50">
                <span className="text-xs text-gray-400">{l.relationship}</span>
                <span className="ml-2 text-gray-700">{l.linkedDecision?.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="mt-5 border-t border-gray-200 pt-4 text-xs text-gray-400">
        <p>Quality: {(decision.quality * 100).toFixed(0)}% | Importance: {(decision.importance * 100).toFixed(0)}%</p>
        <p>Created: {new Date(decision.createdAt).toLocaleDateString()}</p>
        <p>Source: {decision.source}</p>
      </div>
    </div>
  );
}
