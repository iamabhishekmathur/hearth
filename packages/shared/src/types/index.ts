export * from './llm.js';
export * from './user.js';
export * from './auth.js';
export * from './memory.js';
export * from './task.js';

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown>;
  createdBy?: string | null;
  createdAt: string;
}

export type SessionVisibility = 'private' | 'org';
export type CollaboratorRole = 'viewer' | 'contributor';

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  status: 'active' | 'archived';
  visibility: SessionVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface SessionCollaborator {
  id: string;
  sessionId: string;
  userId: string;
  role: CollaboratorRole;
  addedBy: string;
  createdAt: string;
}

export interface SharedSessionInfo extends ChatSession {
  ownerName?: string;
  collaboratorCount?: number;
}

export interface PresenceUser {
  userId: string;
  name: string;
}

export interface CollaboratorAddedEvent {
  sessionId: string;
  sessionTitle: string | null;
  addedByName: string;
  role: CollaboratorRole;
}

export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_call_result'; tool: string; output: Record<string, unknown> }
  | { type: 'file_created'; path: string; mime_type: string }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: { input_tokens: number; output_tokens: number } };

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
}

// ── Routines ──

export type RoutineRunStatus = 'success' | 'failed' | 'running';

export interface Routine {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  prompt: string;
  schedule: string;
  context: Record<string, unknown>;
  delivery: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: RoutineRunStatus | null;
  createdVia: string;
  createdAt: string;
  updatedAt: string;
  runs?: RoutineRun[];
}

export interface RoutineRun {
  id: string;
  routineId: string;
  status: RoutineRunStatus;
  output: Record<string, unknown> | null;
  error: string | null;
  tokenCount: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateRoutineRequest {
  name: string;
  description?: string;
  prompt: string;
  schedule: string;
  context?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
}

export interface UpdateRoutineRequest {
  name?: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  context?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
}

// ── Skill Recommendations ──

export interface SkillRecommendation {
  skillId: string;
  name: string;
  description: string | null;
  score: number;
  reasons: string[];
}

// ── Activity Feed ──

export interface ActivityEvent {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
