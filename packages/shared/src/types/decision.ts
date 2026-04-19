// ── Context Graph Types ──

export type DecisionStatus = 'draft' | 'active' | 'superseded' | 'reversed' | 'archived';
export type DecisionSource = 'chat' | 'task' | 'meeting' | 'slack' | 'email' | 'routine' | 'manual' | 'external';
export type DecisionScope = 'org' | 'team' | 'personal';
export type DecisionConfidence = 'low' | 'medium' | 'high';
export type DecisionRelationship = 'depends_on' | 'supersedes' | 'related_to' | 'informed_by' | 'contradicts';
export type OutcomeVerdict = 'positive' | 'negative' | 'mixed' | 'neutral' | 'too_early';
export type PatternStatus = 'emerging' | 'established' | 'deprecated';
export type PrincipleStatus = 'proposed' | 'active' | 'principle_deprecated';
export type DecisionSensitivity = 'normal' | 'restricted' | 'confidential';

export interface Decision {
  id: string;
  orgId: string;
  teamId: string | null;
  createdById: string;
  sessionId: string | null;
  title: string;
  description: string | null;
  reasoning: string;
  alternatives: Array<{ label: string; pros?: string; cons?: string }>;
  domain: string | null;
  tags: string[];
  scope: DecisionScope;
  status: DecisionStatus;
  confidence: DecisionConfidence;
  source: DecisionSource;
  sourceRef: Record<string, unknown> | null;
  sensitivity: DecisionSensitivity;
  participants: string[];
  contextSnapshot: Record<string, unknown> | null;
  quality: number;
  importance: number;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional relations
  createdByName?: string;
  outcomes?: DecisionOutcome[];
  links?: DecisionLink[];
  contexts?: DecisionContextItem[];
}

export interface DecisionContextItem {
  id: string;
  decisionId: string;
  contextType: string;
  contextId: string | null;
  label: string | null;
  snippet: string | null;
  createdAt: string;
}

export interface DecisionLink {
  id: string;
  fromDecisionId: string;
  toDecisionId: string;
  relationship: DecisionRelationship;
  description: string | null;
  createdById: string | null;
  createdAt: string;
  // Populated in responses
  linkedDecision?: {
    id: string;
    title: string;
    status: DecisionStatus;
    domain: string | null;
  };
}

export interface DecisionOutcome {
  id: string;
  decisionId: string;
  observedById: string;
  verdict: OutcomeVerdict;
  description: string;
  impactScore: number | null;
  evidence: Record<string, unknown> | null;
  createdAt: string;
  observedByName?: string;
}

export interface DecisionPattern {
  id: string;
  orgId: string;
  teamId: string | null;
  name: string;
  description: string;
  domain: string | null;
  conditions: string | null;
  typicalOutcome: string | null;
  status: PatternStatus;
  decisionCount: number;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrgPrinciple {
  id: string;
  orgId: string;
  domain: string | null;
  title: string;
  description: string;
  guideline: string;
  antiPattern: string | null;
  status: PrincipleStatus;
  confidence: number;
  version: number;
  lastSyncedToSoul: string | null;
  lastSyncedToGov: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingIngestion {
  id: string;
  orgId: string;
  provider: 'granola' | 'otter' | 'fireflies' | 'manual';
  externalMeetingId: string | null;
  title: string;
  participants: string[];
  meetingDate: string;
  transcript: string | null;
  summary: string | null;
  calendarEventId: string | null;
  processedAt: string | null;
  decisionsExtracted: number;
  createdAt: string;
}

// ── Request/Response Types ──

export interface CreateDecisionRequest {
  title: string;
  reasoning: string;
  description?: string;
  alternatives?: Array<{ label: string; pros?: string; cons?: string }>;
  domain?: string;
  tags?: string[];
  scope?: DecisionScope;
  confidence?: DecisionConfidence;
  source?: DecisionSource;
  sourceRef?: Record<string, unknown>;
  sensitivity?: DecisionSensitivity;
  participants?: string[];
  teamId?: string;
}

export interface UpdateDecisionRequest {
  title?: string;
  description?: string;
  reasoning?: string;
  alternatives?: Array<{ label: string; pros?: string; cons?: string }>;
  domain?: string;
  tags?: string[];
  scope?: DecisionScope;
  status?: DecisionStatus;
  confidence?: DecisionConfidence;
  sensitivity?: DecisionSensitivity;
  importance?: number;
}

export interface DecisionSearchRequest {
  query: string;
  domain?: string;
  scope?: DecisionScope;
  status?: DecisionStatus;
  stakeholder?: string;
  since?: string;
  limit?: number;
}

export interface DecisionSearchResponse {
  decisions: Decision[];
  total: number;
}

export interface DecisionGraphNode {
  id: string;
  title: string;
  domain: string | null;
  status: DecisionStatus;
  confidence: DecisionConfidence;
  connectionCount: number;
}

export interface DecisionGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: DecisionRelationship;
}

export interface DecisionGraphResponse {
  nodes: DecisionGraphNode[];
  edges: DecisionGraphEdge[];
}

export interface CreateDecisionLinkRequest {
  toDecisionId: string;
  relationship: DecisionRelationship;
  description?: string;
}

export interface RecordOutcomeRequest {
  verdict: OutcomeVerdict;
  description: string;
  impactScore?: number;
  evidence?: Record<string, unknown>;
}
