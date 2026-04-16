import { useEffect, useState, useCallback } from 'react';
import { useAdminTeams } from '@/hooks/use-admin';

export function TeamManagement() {
  const { teams, loading, fetchTeams, createTeam, deleteTeam } = useAdminTeams();
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await createTeam(newName);
    setNewName('');
    setShowForm(false);
    fetchTeams();
  }, [newName, createTeam, fetchTeams]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteTeam(id);
    fetchTeams();
  }, [deleteTeam, fetchTeams]);

  if (loading) return <p className="text-sm text-gray-400">Loading teams...</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Teams ({teams.length})</h3>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-hearth-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-700"
        >
          New Team
        </button>
      </div>

      {showForm && (
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Team name..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none"
            autoFocus
          />
          <button type="button" onClick={handleCreate} className="rounded-lg bg-hearth-600 px-3 py-1.5 text-xs text-white hover:bg-hearth-700">Create</button>
          <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
        </div>
      )}

      <div className="space-y-2">
        {teams.map((team) => (
          <div key={team.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{team.name}</p>
              <p className="text-xs text-gray-400">{team._count?.users ?? 0} members</p>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(team.id)}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
