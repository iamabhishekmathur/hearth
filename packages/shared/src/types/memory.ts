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

// ── Knowledge loop, Phase 2: curator proposals ─────────────────────────────

export type KnowledgeProposalTargetType = 'memory' | 'routine';

export type KnowledgeProposalStatus =
  | 'pending'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'superseded'
  | 'dropped';

/** Who a change reaches. */
export interface KnowledgeProposalAffected {
  /** org = everyone in the org, team = one team, person = one person. */
  audience: 'org' | 'team' | 'person';
  teamName?: string | null;
  personName?: string | null;
  /** Routines whose prompt this changes (for a routine target: itself). */
  routines?: Array<{ id: string; name: string }>;
}

/** One piece of evidence behind a card, shown only as far as the viewer may see it. */
export interface KnowledgeEvidenceItem {
  kind: string;
  source: string;
  createdAt: string;
  /** Plain sentence, e.g. "A member corrected an answer." */
  label: string;
  /** The redacted signal text — only when the viewer can open where it came from. */
  quote: string | null;
  /** A link the viewer can open, or null. */
  link:
    | { type: 'session'; sessionId: string }
    | { type: 'routine_run'; routineId: string; runId: string | null }
    | null;
}

export interface KnowledgeProposalEvidence {
  /** Signal counts by kind (empty_search, correction, thumbs_down, …). */
  counts: Record<string, number>;
  /** Distinct people behind the signals. */
  people: number;
  items: KnowledgeEvidenceItem[];
}

export interface KnowledgeProposal {
  id: string;
  targetType: KnowledgeProposalTargetType;
  targetId: string;
  targetName: string;
  /** Who owns the target, as a short label ("Admins", "Engineering leads", "Ada"). */
  ownerLabel: string;
  targetVersion: number;
  before: string;
  after: string;
  reason: string;
  affected: KnowledgeProposalAffected;
  status: KnowledgeProposalStatus;
  availableAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  editedAfter: string | null;
  resultVersion: number | null;
  createdAt: string;
  evidence: KnowledgeProposalEvidence;
}

export interface ApproveProposalRequest {
  /** Owner-edited text. When given (and different), the card is saved as "edited". */
  after?: string;
  /**
   * After a 409 conflict: the target version the owner has now looked at.
   * The change is applied on top of that version instead.
   */
  baseVersion?: number;
}

export interface RejectProposalRequest {
  reason?: string;
}
