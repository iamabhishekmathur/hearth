import { useState, useEffect } from 'react';
import { useRoutineAnalytics } from '@/hooks/use-routine-analytics';

function HealthCard({ analytic }: { analytic: { routineId: string; routineName: string; totalRuns: number; successRate: number; avgDurationMs: number; totalTokens: number; lastRunAt: string | null } }) {
  const successColor = analytic.successRate >= 90
    ? 'text-green-700 bg-green-50'
    : analytic.successRate >= 70
      ? 'text-yellow-700 bg-yellow-50'
      : 'text-red-700 bg-red-50';

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="truncate text-sm font-semibold text-gray-900">{analytic.routineName}</h4>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${successColor}`}>
          {analytic.successRate.toFixed(0)}%
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-400">Runs</span>
          <p className="font-medium text-gray-700">{analytic.totalRuns}</p>
        </div>
        <div>
          <span className="text-gray-400">Avg Duration</span>
          <p className="font-medium text-gray-700">
            {analytic.avgDurationMs < 1000
              ? `${Math.round(analytic.avgDurationMs)}ms`
              : `${(analytic.avgDurationMs / 1000).toFixed(1)}s`}
          </p>
        </div>
        <div>
          <span className="text-gray-400">Tokens</span>
          <p className="font-medium text-gray-700">{analytic.totalTokens.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-gray-400">Last Run</span>
          <p className="font-medium text-gray-700">
            {analytic.lastRunAt ? new Date(analytic.lastRunAt).toLocaleDateString() : 'Never'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function RoutineDashboardPage() {
  const { analytics, alerts, loading, fetchAnalytics, fetchAlerts, createAlert, deleteAlert } = useRoutineAnalytics();
  const [newAlertRoutineId, setNewAlertRoutineId] = useState('');
  const [newAlertType, setNewAlertType] = useState('consecutive_failures');

  useEffect(() => {
    fetchAnalytics();
    fetchAlerts();
  }, [fetchAnalytics, fetchAlerts]);

  const totalRuns = analytics.reduce((sum, a) => sum + a.totalRuns, 0);
  const avgSuccessRate = analytics.length > 0
    ? analytics.reduce((sum, a) => sum + a.successRate, 0) / analytics.length
    : 0;
  const totalTokens = analytics.reduce((sum, a) => sum + a.totalTokens, 0);

  const handleCreateAlert = async () => {
    if (!newAlertRoutineId) return;
    const threshold = newAlertType === 'consecutive_failures'
      ? { count: 3 }
      : newAlertType === 'missed_schedule'
        ? { hours: 24 }
        : { tokens: 100000 };
    await createAlert({ routineId: newAlertRoutineId, alertType: newAlertType, threshold });
    setNewAlertRoutineId('');
    fetchAlerts();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">Routine Health</h1>
        <p className="mt-0.5 text-sm text-gray-500">Organization-wide routine monitoring</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-hearth-600" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Total Runs</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{totalRuns.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Avg Success Rate</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{avgSuccessRate.toFixed(1)}%</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Total Tokens</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{totalTokens.toLocaleString()}</p>
              </div>
            </div>

            {/* Routine health cards */}
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Routine Performance</h2>
              {analytics.length === 0 ? (
                <p className="text-sm text-gray-400">No routine data available.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {analytics.map((a) => (
                    <HealthCard key={a.routineId} analytic={a} />
                  ))}
                </div>
              )}
            </div>

            {/* Health alerts */}
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Health Alerts</h2>

              {alerts.length > 0 && (
                <div className="mb-3 space-y-2">
                  {alerts.map((alert) => (
                    <div key={alert.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2.5">
                      <div>
                        <span className="text-sm font-medium text-gray-700">
                          {alert.alertType.replace(/_/g, ' ')}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">
                          {JSON.stringify(alert.threshold)}
                        </span>
                        {alert.lastFiredAt && (
                          <span className="ml-2 text-xs text-red-500">
                            Last fired: {new Date(alert.lastFiredAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={async () => { await deleteAlert(alert.id); fetchAlerts(); }}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add alert */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <select
                    value={newAlertRoutineId}
                    onChange={(e) => setNewAlertRoutineId(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select routine...</option>
                    {analytics.map((a) => (
                      <option key={a.routineId} value={a.routineId}>{a.routineName}</option>
                    ))}
                  </select>
                </div>
                <select
                  value={newAlertType}
                  onChange={(e) => setNewAlertType(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="consecutive_failures">Consecutive failures</option>
                  <option value="missed_schedule">Missed schedule</option>
                  <option value="high_cost">High cost</option>
                </select>
                <button
                  type="button"
                  onClick={handleCreateAlert}
                  disabled={!newAlertRoutineId}
                  className="rounded-lg bg-hearth-600 px-3 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
                >
                  Add Alert
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
