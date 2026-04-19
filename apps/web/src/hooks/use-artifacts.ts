import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import type { ApiResponse } from '@hearth/shared';

export interface Artifact {
  id: string;
  sessionId: string;
  type: 'code' | 'document' | 'diagram' | 'table' | 'html' | 'image';
  title: string;
  content: string;
  language: string | null;
  version: number;
  createdBy: string;
  createdByName?: string;
  parentMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  content: string;
  title: string;
  editedBy: string;
  editedByName?: string;
  createdAt: string;
}

interface UseArtifactsReturn {
  artifacts: Artifact[];
  activeArtifact: Artifact | null;
  activeArtifactId: string | null;
  panelOpen: boolean;
  versions: ArtifactVersion[];
  openArtifact: (id: string) => void;
  closePanel: () => void;
  togglePanel: () => void;
  fetchVersions: (artifactId: string) => void;
}

export function useArtifacts(sessionId: string | null): UseArtifactsReturn {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);

  // Fetch artifacts when session changes
  useEffect(() => {
    if (!sessionId) {
      setArtifacts([]);
      setActiveArtifactId(null);
      setPanelOpen(false);
      return;
    }

    api
      .get<ApiResponse<Artifact[]>>(`/chat/sessions/${sessionId}/artifacts`)
      .then((res) => {
        if (res.data) setArtifacts(res.data);
      })
      .catch(() => {
        // Silently fail — artifacts are non-critical
      });
  }, [sessionId]);

  // Listen for real-time artifact events via Socket.io
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !sessionId) return;

    const handleCreated = (artifact: Artifact) => {
      setArtifacts((prev) => [artifact, ...prev]);
      setActiveArtifactId(artifact.id);
      setPanelOpen(true);
    };

    const handleUpdated = (artifact: Artifact) => {
      setArtifacts((prev) => prev.map((a) => (a.id === artifact.id ? artifact : a)));
    };

    const handleDeleted = ({ artifactId }: { artifactId: string }) => {
      setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
      setActiveArtifactId((prevId) => {
        if (prevId === artifactId) {
          setPanelOpen(false);
          return null;
        }
        return prevId;
      });
    };

    socket.on('artifact:created', handleCreated);
    socket.on('artifact:updated', handleUpdated);
    socket.on('artifact:deleted', handleDeleted);

    return () => {
      socket.off('artifact:created', handleCreated);
      socket.off('artifact:updated', handleUpdated);
      socket.off('artifact:deleted', handleDeleted);
    };
  }, [sessionId]);

  const openArtifact = useCallback((id: string) => {
    setActiveArtifactId(id);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const fetchVersions = useCallback(async (artifactId: string) => {
    try {
      const res = await api.get<ApiResponse<ArtifactVersion[]>>(
        `/chat/artifacts/${artifactId}/versions`,
      );
      if (res.data) setVersions(res.data);
    } catch {
      setVersions([]);
    }
  }, []);

  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId) ?? null;

  return {
    artifacts,
    activeArtifact,
    activeArtifactId,
    panelOpen,
    versions,
    openArtifact,
    closePanel,
    togglePanel,
    fetchVersions,
  };
}
