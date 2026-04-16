import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface IdentityDoc {
  id: string;
  content: string;
  fileType: string;
  updatedAt: string;
}

export function useIdentity() {
  const [loading, setLoading] = useState(false);

  const getIdentity = useCallback(async (level: 'org' | 'user', fileType: 'soul' | 'identity') => {
    setLoading(true);
    try {
      const res = await api.get<{ data: IdentityDoc | null }>(`/identity/${level}/${fileType}`);
      return res.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveIdentity = useCallback(async (level: 'org' | 'user', fileType: 'soul' | 'identity', content: string) => {
    setLoading(true);
    try {
      const res = await api.put<{ data: IdentityDoc }>(`/identity/${level}/${fileType}`, { content });
      return res.data;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, getIdentity, saveIdentity };
}
