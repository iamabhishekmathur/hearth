import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface CreateSkillPanelProps {
  onClose: () => void;
  onCreated: () => void;
}

const TEMPLATE = `---
name: my-skill-name
description: A brief description of what this skill does
---

# My Skill Name

## Overview
Describe what this skill helps the AI agent do.

## When to Use
- Situation A
- Situation B

## Process
1. Step one
2. Step two
3. Step three
`;

export function CreateSkillPanel({ onClose, onCreated }: CreateSkillPanelProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState(TEMPLATE);
  const [scope, setScope] = useState<'personal' | 'team' | 'org'>('personal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReview = scope !== 'personal';

  const handleSave = useCallback(async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    if (!description.trim()) { setError('Description is required'); return; }

    setSaving(true);
    try {
      await api.post('/skills', {
        name: name.trim(),
        description: description.trim(),
        content,
        scope,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  }, [name, description, content, scope, onCreated]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Create Skill</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-skill-name"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">Lowercase letters, digits, and hyphens</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this skill"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Scope</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'personal' | 'team' | 'org')}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          >
            <option value="personal">Personal — only you</option>
            <option value="team">Team — your team</option>
            <option value="org">Organization — everyone</option>
          </select>
        </div>

        {needsReview && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs text-amber-800">
              Team and org skills require admin approval before they appear in the skill browser.
              Your skill will be created as a draft and submitted for review.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Content
            <span className="ml-1 font-normal text-gray-400">(Markdown + YAML frontmatter)</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-xs leading-relaxed focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-lg bg-hearth-600 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : needsReview ? 'Create & Submit for Review' : 'Create Skill'}
        </button>
      </div>
    </div>
  );
}
