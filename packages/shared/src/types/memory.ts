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
  /** Current version number (knowledge loop). Starts at 1. */
  version?: number;
  /** Explicit owner; null means the default owner for the layer. */
  ownerId?: string | null;
}

/** Who or what made a version of a memory entry or routine. */
export type KnowledgeChangeSource =
  | 'user'
  | 'agent'
  | 'synthesis'
  | 'rollback'
  | 'migration'
  | 'curator';

export interface MemoryVersion {
  id: string;
  memoryId: string;
  version: number;
  content: string;
  changeSource: KnowledgeChangeSource;
  changedById: string | null;
  /** For a rollback: the version whose content was restored. */
  restoredFrom: number | null;
  createdAt: string;
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
  /** Optimistic concurrency: reject with 409 if the entry moved past this version. */
  expectedVersion?: number;
}

export interface RollbackRequest {
  /** The earlier version to restore. A new version is written with its content. */
  version: number;
}

export interface SetOwnerRequest {
  /** A user in the same org, or null to fall back to the default owner. */
  ownerId: string | null;
}

export interface MemorySearchRequest {
  query: string;
  layer?: MemoryLayer;
  limit?: number;
}

export interface MemorySearchResult extends MemoryEntry {
  score: number;
}
