import { useEffect } from 'react';
import { useAdminAnalytics } from '@/hooks/use-admin';

export function UsageAnalytics() {
  const { analytics, loading, fetchAnalytics } = useAdminAnalytics();

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading || !analytics) {
    return <p className="text-sm text-gray-400">Loading analytics...</p>;
  }

  return (
    <div>
      <h3 className="mb-4 text-base font-semibold text-gray-900">Usage Analytics</h3>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">DAU</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{analytics.dau}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Sessions (30d)</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{analytics.totalSessions}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Messages (30d)</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{analytics.totalMessages}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Tokens (30d)</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {analytics.tokenUsage.total.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Top actions */}
      {analytics.topActions.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-medium text-gray-700">Top Actions</h4>
          <div className="space-y-1">
            {analytics.topActions.map((a) => (
              <div key={a.action} className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5">
                <span className="text-sm text-gray-700">{a.action}</span>
                <span className="text-sm font-medium text-gray-900">{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
