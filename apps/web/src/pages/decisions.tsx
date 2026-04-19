import { useState, useCallback } from 'react';
import { useDecisions, useDecision, usePatterns, usePrinciples, usePendingReview } from '@/hooks/use-decisions';
import { DecisionDetailPanel } from '@/components/decisions/decision-detail-panel';
import { DecisionCaptureForm } from '@/components/decisions/decision-capture-form';

type Tab = 'timeline' | 'graph' | 'patterns' | 'principles';

const DOMAIN_OPTIONS = ['engineering', 'product', 'hiring', 'design', 'operations', 'marketing', 'finance', 'legal', 'strategy', 'other'];

function getTimeBucket(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This Week';
  if (days < 30) return 'This Month';
  return 'Older';
}

function DomainBadge({ domain }: { domain: string | null }) {
  if (!domain) return null;
  const colors: Record<string, string> = {
    engineering: 'bg-blue-100 text-blue-700',
    product: 'bg-purple-100 text-purple-700',
    hiring: 'bg-green-100 text-green-700',
    design: 'bg-pink-100 text-pink-700',
    operations: 'bg-orange-100 text-orange-700',
    marketing: 'bg-yellow-100 text-yellow-700',
    finance: 'bg-emerald-100 text-emerald-700',
    legal: 'bg-red-100 text-red-700',
    strategy: 'bg-indigo-100 text-indigo-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[domain] ?? 'bg-gray-100 text-gray-700'}`}>
      {domain}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    high: 'text-green-600',
    medium: 'text-yellow-600',
    low: 'text-red-600',
  };
  return <span className={`text-xs font-medium ${colors[confidence] ?? 'text-gray-500'}`}>{confidence}</span>;
}

function TimelineView({ decisions, onSelect }: { decisions: any[]; onSelect: (id: string) => void }) {
  const grouped = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const bucket = getTimeBucket(d.createdAt);
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)!.push(d);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([bucket, items]) => (
        <div key={bucket}>
          <h3 className="mb-3 text-sm font-semibold text-gray-500">{bucket}</h3>
          <div className="space-y-2">
            {items.map((d: any) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelect(d.id)}
                className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-hearth-300 hover:bg-hearth-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-medium text-gray-900">{d.title}</h4>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{d.reasoning}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <DomainBadge domain={d.domain} />
                    <ConfidenceBadge confidence={d.confidence} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                  <span>{d.createdByName ?? 'System'}</span>
                  {d.outcomeCount > 0 && <span>{d.outcomeCount} outcome{d.outcomeCount > 1 ? 's' : ''}</span>}
                  {d.linkCount > 0 && <span>{d.linkCount} link{d.linkCount > 1 ? 's' : ''}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PatternsView({ domain }: { domain?: string }) {
  const { patterns, loading } = usePatterns(domain);
  if (loading) return <p className="text-sm text-gray-400">Loading patterns...</p>;
  if (patterns.length === 0) return <p className="text-sm text-gray-400">No patterns found yet. Patterns emerge after 3+ decisions in a domain.</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {patterns.map(p => (
        <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-900">{p.name}</h4>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              p.status === 'established' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
            }`}>{p.status}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">{p.description}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <DomainBadge domain={p.domain} />
            <span>{p.decisionCount} decisions</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PrinciplesView({ domain }: { domain?: string }) {
  const { principles, loading } = usePrinciples(domain);
  if (loading) return <p className="text-sm text-gray-400">Loading principles...</p>;
  if (principles.length === 0) return <p className="text-sm text-gray-400">No principles distilled yet. Principles emerge from established patterns.</p>;

  return (
    <div className="space-y-4">
      {principles.map(p => (
        <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-semibold text-gray-900">{p.title}</h4>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
            }`}>{p.status}</span>
          </div>
          <p className="mt-2 text-sm text-gray-600">{p.description}</p>
          <div className="mt-3 rounded-lg bg-green-50 p-3">
            <p className="text-xs font-medium text-green-800">Guideline</p>
            <p className="text-sm text-green-700">{p.guideline}</p>
          </div>
          {p.antiPattern && (
            <div className="mt-2 rounded-lg bg-red-50 p-3">
              <p className="text-xs font-medium text-red-800">Anti-pattern</p>
              <p className="text-sm text-red-700">{p.antiPattern}</p>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <DomainBadge domain={p.domain} />
            <span>v{p.version}</span>
            {p.lastSyncedToSoul && <span>Synced to SOUL.md</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DecisionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('timeline');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [showCaptureForm, setShowCaptureForm] = useState(false);
  const { decisions, loading, hasMore, loadMore, refresh } = useDecisions({ domain: domainFilter || undefined });
  const { decision: selectedDecision } = useDecision(selectedId);
  const { decisions: pendingDecisions, confirm, dismiss } = usePendingReview();

  const tabs: { value: Tab; label: string }[] = [
    { value: 'timeline', label: 'Timeline' },
    { value: 'graph', label: 'Graph' },
    { value: 'patterns', label: 'Patterns' },
    { value: 'principles', label: 'Principles' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Decision Graph</h1>
            <p className="mt-0.5 text-sm text-gray-500">Organizational decision history and patterns</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCaptureForm(true)}
            className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700"
          >
            Capture Decision
          </button>
        </div>

        {/* Review banner */}
        {pendingDecisions.length > 0 && (
          <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-yellow-800">{pendingDecisions.length} decision{pendingDecisions.length > 1 ? 's' : ''} need review</span>
              <div className="flex gap-2">
                {pendingDecisions.slice(0, 2).map(d => (
                  <div key={d.id} className="flex items-center gap-1">
                    <span className="max-w-[200px] truncate text-xs text-yellow-700">{d.title}</span>
                    <button type="button" onClick={() => confirm(d.id)} className="rounded px-1.5 py-0.5 text-xs font-medium text-green-700 hover:bg-green-100">Approve</button>
                    <button type="button" onClick={() => dismiss(d.id)} className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">Dismiss</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs + Filters */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6">
        <div className="flex">
          {tabs.map(tab => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.value
                  ? 'border-hearth-600 text-hearth-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 py-2">
          <select
            value={domainFilter}
            onChange={e => setDomainFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-hearth-500 focus:outline-none"
          >
            <option value="">All Domains</option>
            {DOMAIN_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className={`flex-1 overflow-y-auto p-6 ${selectedId ? 'w-3/5' : ''}`}>
          {loading && decisions.length === 0 ? (
            <p className="text-center text-sm text-gray-400">Loading decisions...</p>
          ) : (
            <>
              {activeTab === 'timeline' && (
                <>
                  <TimelineView decisions={decisions} onSelect={setSelectedId} />
                  {hasMore && (
                    <button type="button" onClick={loadMore} className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50">
                      Load more
                    </button>
                  )}
                </>
              )}
              {activeTab === 'graph' && (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-500">Graph View</p>
                    <p className="mt-1 text-xs text-gray-400">Select a decision from the timeline to explore its graph</p>
                  </div>
                </div>
              )}
              {activeTab === 'patterns' && <PatternsView domain={domainFilter || undefined} />}
              {activeTab === 'principles' && <PrinciplesView domain={domainFilter || undefined} />}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selectedId && selectedDecision && (
          <DecisionDetailPanel
            decision={selectedDecision}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* Capture form modal */}
      {showCaptureForm && (
        <DecisionCaptureForm
          onClose={() => setShowCaptureForm(false)}
          onSaved={() => { setShowCaptureForm(false); refresh(); }}
        />
      )}
    </div>
  );
}
