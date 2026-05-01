import { useState } from 'react';
import { api } from '@/lib/api-client';
import type { CreateDecisionRequest, Decision } from '@hearth/shared';

interface Props {
  onClose: () => void;
  onSaved: (decision: Decision) => void;
}

const DOMAIN_OPTIONS = ['engineering', 'product', 'hiring', 'design', 'operations', 'marketing', 'finance', 'legal', 'strategy', 'other'];

export function DecisionCaptureForm({ onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [domain, setDomain] = useState('');
  const [scope, setScope] = useState<'org' | 'team' | 'personal'>('org');
  const [tags, setTags] = useState('');
  const [confidence, setConfidence] = useState<'low' | 'medium' | 'high'>('medium');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !reasoning) return;
    setSaving(true);
    try {
      const data: CreateDecisionRequest = {
        title,
        reasoning,
        domain: domain || undefined,
        scope,
        confidence,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      };
      const res = await api.post<{ data: Decision }>('/decisions', data);
      onSaved(res.data);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="mx-4 w-full max-w-lg rounded-xl bg-hearth-card p-6 shadow-hearth-4 animate-scale-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-hearth-text">Capture Decision</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-hearth-text-faint hover:bg-hearth-chip">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-hearth-text">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What was decided?"
              className="mt-1 w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-hearth-text">Reasoning *</label>
            <textarea
              value={reasoning}
              onChange={e => setReasoning(e.target.value)}
              placeholder="Why was this decided? What factors were considered?"
              rows={3}
              className="mt-1 w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-hearth-text">Domain</label>
              <select
                value={domain}
                onChange={e => setDomain(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
              >
                <option value="">Select...</option>
                {DOMAIN_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-hearth-text">Scope</label>
              <select
                value={scope}
                onChange={e => setScope(e.target.value as typeof scope)}
                className="mt-1 w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
              >
                <option value="org">Organization</option>
                <option value="team">Team</option>
                <option value="personal">Personal</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-hearth-text">Confidence</label>
              <select
                value={confidence}
                onChange={e => setConfidence(e.target.value as typeof confidence)}
                className="mt-1 w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-hearth-text">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="comma, separated, tags"
                className="mt-1 w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm focus:border-hearth-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-hearth-border-strong px-4 py-2 text-sm font-medium text-hearth-text hover:bg-hearth-bg">
              Cancel
            </button>
            <button type="submit" disabled={!title || !reasoning || saving} className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Capture'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
