export type TaskStatus =
  | 'auto_detected'
  | 'backlog'
  | 'planning'
  | 'executing'
  | 'review'
  | 'done'
  | 'failed'
  | 'archived';

export type TaskSource =
  | 'email'
  | 'slack'
  | 'meeting'
  | 'manual'
  | 'agent_proposed'
  | 'sub_agent'
  | 'chat_user';

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

/** Phase of the pipeline this step belongs to */
export type TaskStepPhase = 'planning' | 'execution';

/** Review decision at the human-in-the-loop gate */
export type ReviewDecision = 'approved' | 'changes_requested';

// ── Rich Task Context ──

export type TaskContextItemType = 'note' | 'link' | 'file' | 'image' | 'text_block' | 'mcp_reference' | 'chat_excerpt';
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface TaskContextItem {
  id: string;
  taskId: string;
  type: TaskContextItemType;
  label: string | null;
  rawValue: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string | null;
  extractedText: string | null;
  extractedTitle: string | null;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  mcpIntegrationId: string | null;
  mcpResourceType: string | null;
  mcpResourceId: string | null;
  visionAnalysis: string | null;
  deepLink: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskContextItemRequest {
  type: TaskContextItemType;
  rawValue: string;
  label?: string;
  mcpIntegrationId?: string;
  mcpResourceType?: string;
  mcpResourceId?: string;
}

export interface UpdateTaskContextItemRequest {
  label?: string;
  sortOrder?: number;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  source: TaskSource;
  sourceRef: Record<string, unknown> | null;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  sourceSession?: { id: string; title: string | null } | null;
  context: Record<string, unknown>;
  parentTaskId: string | null;
  agentOutput: Record<string, unknown> | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
  subTasks?: Task[];
  comments?: TaskComment[];
  executionSteps?: TaskExecutionStep[];
  reviews?: TaskReview[];
  contextItems?: TaskContextItem[];
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string | null;
  isAgent: boolean;
  content: string;
  createdAt: string;
}

export interface TaskExecutionStep {
  id: string;
  taskId: string;
  stepNumber: number;
  description: string;
  status: TaskStepStatus;
  phase: TaskStepPhase | null;
  toolUsed: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
}

export interface TaskReview {
  id: string;
  taskId: string;
  reviewerId: string;
  decision: ReviewDecision;
  feedback: string | null;
  createdAt: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  source: TaskSource;
  priority?: number;
  parentTaskId?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
}

export interface CreateReviewRequest {
  decision: ReviewDecision;
  feedback?: string;
}

/**
 * Valid status transitions for kanban.
 *
 * Notable edges:
 * - review → planning: when reviewer requests changes, task re-enters planning with feedback
 * - review → archived: cancellation path from the review gate
 * - backlog → planning: triggers the planning agent
 * - planning → executing: auto-advanced by the planner when subtasks are generated
 */
export const VALID_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  auto_detected: ['backlog', 'archived'],
  backlog: ['planning', 'archived'],
  planning: ['backlog', 'executing', 'archived'],
  executing: ['review', 'failed', 'archived', 'planning'],
  review: ['planning', 'executing', 'done', 'archived'],
  done: ['archived'],
  failed: ['backlog', 'planning', 'archived'],
  archived: [],
};
