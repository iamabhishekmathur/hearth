import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { UserRole } from '@hearth/shared';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId: string | null;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
  orgId: string;
  createdAt: string;
  _count?: { users: number };
}

interface UsageAnalytics {
  dau: number;
  totalSessions: number;
  totalMessages: number;
  tokenUsage: { total: number; byDay: Array<{ date: string; tokens: number }> };
  topActions: Array<{ action: string; count: number }>;
}

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get<{ data: AdminUser[]; total: number }>(`/admin/users?page=${page}`);
      setUsers(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateUser = useCallback(async (id: string, data: { name?: string; role?: UserRole; teamId?: string }) => {
    await api.patch(`/admin/users/${id}`, data);
  }, []);

  const deleteUser = useCallback(async (id: string) => {
    await api.delete(`/admin/users/${id}`);
  }, []);

  return { users, total, loading, fetchUsers, updateUser, deleteUser };
}

export function useAdminTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: Team[] }>('/admin/teams');
      setTeams(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTeam = useCallback(async (name: string) => {
    await api.post('/admin/teams', { name });
  }, []);

  const deleteTeam = useCallback(async (id: string) => {
    await api.delete(`/admin/teams/${id}`);
  }, []);

  return { teams, loading, fetchTeams, createTeam, deleteTeam };
}

export function useAdminAnalytics() {
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = useCallback(async (days = 30) => {
    setLoading(true);
    try {
      const res = await api.get<{ data: UsageAnalytics }>(`/admin/analytics?days=${days}`);
      setAnalytics(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  return { analytics, loading, fetchAnalytics };
}
