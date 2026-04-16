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

  if (loading) return <p className="text-sm text-gray-400">Loading users...</p>;

  return (
    <div>
      <h3 className="mb-4 text-base font-semibold text-gray-900">
        Users ({total})
      </h3>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Email</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Role</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-2 text-sm text-gray-900">{user.name}</td>
                <td className="px-4 py-2 text-sm text-gray-500">{user.email}</td>
                <td className="px-4 py-2">
                  {editingId === user.id ? (
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 capitalize">
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
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:underline">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => { setEditingId(user.id); setEditRole(user.role); }}
                        className="text-xs text-gray-500 hover:text-gray-700"
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
