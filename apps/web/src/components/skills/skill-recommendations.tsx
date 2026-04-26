import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { SkillRecommendation } from '@hearth/shared';

interface SkillRecommendationsProps {
  onInstall: (skillId: string) => Promise<void>;
}

export function SkillRecommendations({ onInstall }: SkillRecommendationsProps) {
  const [recommendations, setRecommendations] = useState<SkillRecommendation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecommendations = useCallback(async () => {
    try {
      const res = await api.get<{ data: SkillRecommendation[] }>('/recommendations/skills');
      setRecommendations(res.data ?? []);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  if (loading || recommendations.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-hearth-text">Recommended for you</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {recommendations.slice(0, 6).map((rec) => (
          <div key={rec.skillId} className="rounded-lg border border-hearth-200 bg-hearth-50 p-3">
            <h3 className="text-sm font-medium text-hearth-text">{rec.name}</h3>
            {rec.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-hearth-text-muted">{rec.description}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {rec.reasons.slice(0, 2).map((reason) => (
                <span key={reason} className="rounded-full bg-hearth-100 px-2 py-0.5 text-[10px] text-hearth-700">
                  {reason}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onInstall(rec.skillId)}
              className="mt-2 rounded bg-hearth-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-hearth-700"
            >
              Install
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
