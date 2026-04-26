import { useEffect } from 'react';
import { useAdminAnalytics } from '@/hooks/use-admin';

export function UsageAnalytics() {
  const { analytics, loading, fetchAnalytics } = useAdminAnalytics();

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading || !analytics) {
    return <p className="text-sm text-hearth-text-faint">Loading analytics...</p>;
  }

  return (
    <div>
      <h3 className="mb-4 text-base font-semibold text-hearth-text">Usage Analytics</h3>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-hearth-border p-4">
          <p className="text-xs font-medium text-hearth-text-muted">DAU</p>
          <p className="mt-1 text-2xl font-bold text-hearth-text">{analytics.dau}</p>
        </div>
        <div className="rounded-lg border border-hearth-border p-4">
          <p className="text-xs font-medium text-hearth-text-muted">Sessions (30d)</p>
          <p className="mt-1 text-2xl font-bold text-hearth-text">{analytics.totalSessions}</p>
        </div>
        <div className="rounded-lg border border-hearth-border p-4">
          <p className="text-xs font-medium text-hearth-text-muted">Messages (30d)</p>
          <p className="mt-1 text-2xl font-bold text-hearth-text">{analytics.totalMessages}</p>
        </div>
        <div className="rounded-lg border border-hearth-border p-4">
          <p className="text-xs font-medium text-hearth-text-muted">Tokens (30d)</p>
          <p className="mt-1 text-2xl font-bold text-hearth-text">
            {analytics.tokenUsage.total.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Top actions */}
      {analytics.topActions.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-medium text-hearth-text">Top Actions</h4>
          <div className="space-y-1">
            {analytics.topActions.map((a) => (
              <div key={a.action} className="flex items-center justify-between rounded bg-hearth-bg px-3 py-1.5">
                <span className="text-sm text-hearth-text">{a.action}</span>
                <span className="text-sm font-medium text-hearth-text">{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
