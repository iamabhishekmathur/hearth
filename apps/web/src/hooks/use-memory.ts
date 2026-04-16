import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type {
  MemoryEntry,
  MemoryLayer,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  MemorySearchResult,
} from '@hearth/shared';

interface PaginatedMemory {
  data: MemoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export function useMemory() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<MemorySearchResult[] | null>(null);

  const fetchMemory = useCallback(async (layer?: MemoryLayer, pageNum = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (layer) params.set('layer', layer);
      params.set('page', String(pageNum));
      params.set('pageSize', '20');
      const qs = params.toString();
      const res = await api.get<PaginatedMemory>(`/memory?${qs}`);
      setEntries(res.data);
      setTotal(res.total);
      setPage(res.page);
    } finally {
      setLoading(false);
    }
  }, []);

  const createMemory = useCallback(async (data: CreateMemoryRequest) => {
    const res = await api.post<{ data: MemoryEntry }>('/memory', data);
    return res.data;
  }, []);

  const updateMemory = useCallback(async (id: string, data: UpdateMemoryRequest) => {
    const res = await api.patch<{ data: MemoryEntry }>(`/memory/${id}`, data);
    return res.data;
  }, []);

  const deleteMemory = useCallback(async (id: string) => {
    await api.delete(`/memory/${id}`);
  }, []);

  const searchMemory = useCallback(async (query: string, layer?: MemoryLayer) => {
    setLoading(true);
    try {
      const res = await api.post<{ data: MemorySearchResult[] }>('/memory/search', {
        query,
        layer,
      });
      setSearchResults(res.data);
      return res.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchResults(null);
  }, []);

  return {
    entries,
    total,
    page,
    loading,
    searchResults,
    fetchMemory,
    createMemory,
    updateMemory,
    deleteMemory,
    searchMemory,
    clearSearch,
  };
}
