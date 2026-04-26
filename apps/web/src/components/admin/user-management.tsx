import { useEffect, useState, useCallback } from 'react';
import { useAdminUsers } from '@/hooks/use-admin';
import type { UserRole } from '@hearth/shared';

const ROLES: UserRole[] = ['admin', 'team_lead', 'member', 'viewer'];

export function UserManagement() {
  const { users, total, loading, fetchUsers, updateUser, deleteUser } = useAdminUsers();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('member');

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSaveRole = useCallback(async (id: string) => {
    await updateUser(id, { role: editRole });
    setEditingId(null);
    fetchUsers();
  }, [editRole, updateUser, fetchUsers]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteUser(id);
    fetchUsers();
  }, [deleteUser, fetchUsers]);

  if (loading) return <p className="text-sm text-hearth-text-faint">Loading users...</p>;

  return (
    <div>
      <h3 className="mb-4 text-base font-semibold text-hearth-text">
        Users ({total})
      </h3>
      <div className="overflow-hidden rounded-lg border border-hearth-border">
        <table className="min-w-full divide-y divide-hearth-border">
          <thead className="bg-hearth-bg">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-hearth-text-muted">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-hearth-text-muted">Email</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-hearth-text-muted">Role</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-hearth-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-hearth-card">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-2 text-sm text-hearth-text">{user.name}</td>
                <td className="px-4 py-2 text-sm text-hearth-text-muted">{user.email}</td>
                <td className="px-4 py-2">
                  {editingId === user.id ? (
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                      className="rounded border border-hearth-border-strong px-2 py-1 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded bg-hearth-chip px-2 py-0.5 text-xs font-medium text-hearth-text-muted capitalize">
                      {user.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {editingId === user.id ? (
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => handleSaveRole(user.id)} className="text-xs text-hearth-600 hover:underline">
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs text-hearth-text-muted hover:underline">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => { setEditingId(user.id); setEditRole(user.role); }}
                        className="text-xs text-hearth-text-muted hover:text-hearth-text"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(user.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
