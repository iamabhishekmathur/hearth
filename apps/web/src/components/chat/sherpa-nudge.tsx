import { useState } from 'react';
import type { SkillRecommendation } from '@hearth/shared';

interface SherpaNudgeProps {
  recommendation: SkillRecommendation;
  onInstall: (skillId: string) => Promise<void>;
  onDismiss: () => void;
}

export function SherpaNudge({ recommendation, onInstall, onDismiss }: SherpaNudgeProps) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstall(recommendation.skillId);
      onDismiss();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="mx-4 mb-3 rounded-lg border border-hearth-200 bg-hearth-50 p-3 animate-fade-in">
      <div className="flex items-start gap-2">
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-hearth-500" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1Z" />
          <path fillRule="evenodd" d="M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" clipRule="evenodd" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-hearth-800">
            Try the &ldquo;{recommendation.name}&rdquo; skill
          </p>
          {recommendation.description && (
            <p className="mt-0.5 text-xs text-hearth-600">{recommendation.description}</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing}
              className="rounded bg-hearth-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
            >
              {installing ? 'Installing...' : 'Install'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs text-hearth-text-muted hover:text-hearth-text"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
