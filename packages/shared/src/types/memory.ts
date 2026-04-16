export type MemoryLayer = 'org' | 'team' | 'user' | 'session';

export interface MemoryEntry {
  id: string;
  orgId: string;
  teamId: string | null;
  userId: string | null;
  layer: MemoryLayer;
  content: string;
  source: string | null;
  sourceRef: Record<string, unknown> | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryRequest {
  layer: MemoryLayer;
  content: string;
  source?: string;
  sourceRef?: Record<string, unknown>;
  expiresAt?: string;
}

export interface UpdateMemoryRequest {
  content?: string;
  source?: string;
  sourceRef?: Record<string, unknown>;
  expiresAt?: string | null;
}

export interface MemorySearchRequest {
  query: string;
  layer?: MemoryLayer;
  limit?: number;
}

export interface MemorySearchResult extends MemoryEntry {
  score: number;
}
