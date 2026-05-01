export * from './llm.js';
export * from './user.js';
export * from './auth.js';
export * from './memory.js';
export * from './task.js';
export * from './compliance.js';
export * from './decision.js';

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  width?: number;
  height?: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown>;
  createdBy?: string | null;
  createdAt: string;
  attachments?: ChatAttachment[];
  respondingToMessageId?: string | null;
  reactions?: ReactionSummary[];
  producedTaskIds?: string[];
}

export interface MessageAuthor {
  id: string;
  name: string;
}

export interface SessionWithMessages extends ChatSession {
  messages: ChatMessage[];
  messageAuthors: Record<string, MessageAuthor>;
  lastReadMessageId?: string | null;
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

export type PresenceState = 'active' | 'viewing' | 'idle';

export interface PresenceUser {
  userId: string;
  name: string;
  state?: PresenceState;
}

export interface ComposingUser {
  userId: string;
  name: string;
  charCount: number;
}

export interface CollaboratorAddedEvent {
  sessionId: string;
  sessionTitle: string | null;
  addedByName: string;
  role: CollaboratorRole;
}

export type NotificationType =
  | 'collaborator_added'
  | 'mention'
  | 'handoff'
  | 'governance_block'
  | 'comment_on_your_message'
  | 'reaction_on_your_message';

export interface NotificationItem {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  sessionId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface TaskCreatedFromChatEvent {
  taskId: string;
  title: string;
  status: string;
  sessionId: string;
  originatingMessageId: string | null;
  messageCount: number;
  existing: boolean;
}

export interface TaskSuggestionEvent {
  id: string;
  sessionId: string;
  messageId: string;
  proposedTitle: string;
  proposedDescription: string | null;
  suggestedContextMessageIds: string[];
  confidence: number;
  createdAt: string;
}

export interface TaskSuggestionResolvedEvent {
  suggestionId: string;
  status: 'accepted' | 'dismissed' | 'expired';
  acceptedTaskId?: string;
}

export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_call_result'; tool: string; output: Record<string, unknown> }
  | { type: 'side_effect'; toolName: string; provider: string }
  | { type: 'file_created'; path: string; mime_type: string }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: { input_tokens: number; output_tokens: number } }
  | { type: 'artifact_create'; artifact: Artifact }
  | { type: 'artifact_update'; artifactId: string; content: string; title: string; version: number };

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

export interface CursorPaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
}

// ── Routines ──

export type RoutineRunStatus = 'success' | 'failed' | 'running' | 'awaiting_approval';
export type RoutineScope = 'personal' | 'team' | 'org';
export type TriggerStatus = 'active' | 'paused' | 'error';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved' | 'auto_rejected' | 'edited';

// Feature 1: State config
export interface RoutineStateConfig {
  previousRunCount?: number;   // default 3, max 10
  trackDeltas?: boolean;       // default false
  maxContextChars?: number;    // default 4000
}

// Feature 4: Parameterized Routines
export type RoutineParameterType = 'string' | 'number' | 'boolean' | 'enum' | 'date' | 'date_range';

export interface RoutineParameter {
  name: string;
  type: RoutineParameterType;
  label: string;
  description?: string;
  required: boolean;
  default?: unknown;
  options?: string[];  // enum type only
}

// Feature 2: Event-Driven Triggers
export interface NormalizedEvent {
  provider: string;
  eventType: string;
  actor?: string;
  resource?: { type: string; id: string; title?: string; url?: string };
  payload: Record<string, unknown>;
  receivedAt: string;
}

export interface WebhookEndpoint {
  id: string;
  orgId: string;
  integrationId: string | null;
  provider: string;
  urlToken: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineTrigger {
  id: string;
  routineId: string;
  webhookEndpointId: string;
  eventType: string;
  filters: Record<string, unknown>;
  parameterMapping: Record<string, string>;
  status: TriggerStatus;
  lastTriggeredAt: string | null;
  createdAt: string;
}

// Feature 5: Approval Gates
export interface ApproverPolicy {
  type: 'creator' | 'role' | 'user_ids';
  roles?: string[];
  userIds?: string[];
}

export interface ApprovalCheckpointDef {
  name: string;
  description?: string;
  position: number;
  approverPolicy: ApproverPolicy;
  timeoutMinutes?: number;
  timeoutAction?: 'approve' | 'reject';
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  checkpointId: string;
  status: ApprovalStatus;
  agentOutput: string | null;
  editedOutput: string | null;
  reviewerId: string | null;
  reviewerComment: string | null;
  timeoutAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// Feature 6: Delivery Rules
export interface DeliveryCondition {
  type: 'always' | 'contains' | 'not_contains' | 'agent_tag';
  value?: string;
}

export interface DeliveryTarget {
  channel: 'in_app' | 'slack' | 'notion' | 'jira' | 'email';
  config: Record<string, unknown>;
  template?: string;
}

export interface DeliveryRule {
  condition: DeliveryCondition;
  targets: DeliveryTarget[];
}

// Feature 7: Cross-Routine Chaining
export interface RoutineChain {
  id: string;
  sourceRoutineId: string;
  targetRoutineId: string;
  condition: 'on_success' | 'on_failure' | 'always';
  parameterMapping: Record<string, string>;
  enabled: boolean;
  createdAt: string;
}

export interface PipelineRun {
  id: string;
  rootRunId: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  runIds: string[];
  startedAt: string;
  completedAt: string | null;
}

// Feature 8: Observability
export interface RoutineHealthAlert {
  id: string;
  orgId: string;
  routineId: string;
  alertType: 'consecutive_failures' | 'missed_schedule' | 'high_cost';
  threshold: Record<string, unknown>;
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface RoutineAnalytics {
  routineId: string;
  routineName: string;
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
  lastRunAt: string | null;
}

export interface Routine {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  prompt: string;
  schedule: string | null;
  context: Record<string, unknown>;
  delivery: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: RoutineRunStatus | null;
  createdVia: string;
  createdAt: string;
  updatedAt: string;
  // Feature 1: State
  state?: Record<string, unknown>;
  stateConfig?: RoutineStateConfig;
  // Feature 3: Scoping
  scope?: RoutineScope;
  teamId?: string | null;
  orgId?: string | null;
  // Feature 4: Parameters
  parameters?: RoutineParameter[];
  // Feature 5: Checkpoints
  checkpoints?: ApprovalCheckpointDef[];
  // Relations
  runs?: RoutineRun[];
  triggers?: RoutineTrigger[];
  chainsFrom?: RoutineChain[];
  chainsTo?: RoutineChain[];
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
  // Feature 1
  summary: string | null;
  // Feature 2
  triggerId?: string | null;
  triggerEvent?: NormalizedEvent | null;
  // Feature 4
  parameterValues?: Record<string, unknown> | null;
  triggeredBy?: string | null;
  // Feature 5
  approvalRequests?: ApprovalRequest[];
}

export interface CreateRoutineRequest {
  name: string;
  description?: string;
  prompt: string;
  schedule?: string;
  context?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
  stateConfig?: RoutineStateConfig;
  scope?: RoutineScope;
  teamId?: string;
  parameters?: RoutineParameter[];
  checkpoints?: ApprovalCheckpointDef[];
}

export interface UpdateRoutineRequest {
  name?: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  context?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
  stateConfig?: RoutineStateConfig;
  state?: Record<string, unknown>;
  scope?: RoutineScope;
  teamId?: string;
  parameters?: RoutineParameter[];
  checkpoints?: ApprovalCheckpointDef[];
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

export const FEED_WORTHY_ACTIONS = [
  'task_completed', 'skill_published', 'skill_install', 'routine_run', 'session_created', 'governance_violation', 'decision_captured',
] as const;
export type FeedAction = (typeof FEED_WORTHY_ACTIONS)[number];

export const REACTION_EMOJIS = ['fire', 'thumbsup', 'heart', 'eyes', 'rocket'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface ActivityEvent {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  reactions?: ReactionSummary[];
  metrics?: {
    installCount?: number;
    totalRuns?: number;
    timeSavedMs?: number;
  };
}

export interface ActivityGroup {
  action: string;
  events: ActivityEvent[];
  collapsed: boolean;
}

export interface ProactiveSignal {
  id: string;
  type: 'stale_routine' | 'skill_recommendation' | 'trending_skill' | 'idle_task' | 'stale_decision' | 'contradicting_decision';
  title: string;
  description: string;
  entityType: string;
  entityId: string;
  actionLabel: string;
  actionUrl: string;
}

// ── Artifacts ──

export type ArtifactType = 'code' | 'document' | 'diagram' | 'table' | 'html' | 'image';

export interface Artifact {
  id: string;
  sessionId: string;
  type: ArtifactType;
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

export interface CreateArtifactRequest {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  parentMessageId?: string;
}

export interface UpdateArtifactRequest {
  title?: string;
  content?: string;
  language?: string;
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

// ── Governance ──

export type GovernanceSeverity = 'info' | 'warning' | 'critical';
export type GovernanceRuleType = 'keyword' | 'regex' | 'llm_evaluation';
export type GovernanceEnforcement = 'monitor' | 'warn' | 'block';
export type GovernanceCategory = 'data_privacy' | 'ip_protection' | 'compliance' | 'custom';
export type GovernanceViolationStatus = 'open' | 'acknowledged' | 'dismissed' | 'escalated';

export interface GovernancePolicy {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  category: GovernanceCategory;
  severity: GovernanceSeverity;
  ruleType: GovernanceRuleType;
  ruleConfig: Record<string, unknown>;
  enforcement: GovernanceEnforcement;
  scope: Record<string, unknown>;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  violationCount?: number;
}

export interface GovernanceViolation {
  id: string;
  orgId: string;
  policyId: string;
  policyName?: string;
  userId: string;
  userName?: string;
  sessionId: string;
  messageId: string | null;
  messageRole: string;
  severity: GovernanceSeverity;
  contentSnippet: string;
  matchDetails: Record<string, unknown>;
  enforcement: GovernanceEnforcement;
  status: GovernanceViolationStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface GovernanceSettings {
  enabled: boolean;
  checkUserMessages: boolean;
  checkAiResponses: boolean;
  notifyAdmins: boolean;
  monitoringBanner: boolean;
}

// ── Cognitive Profiles (Digital Co-Worker) ──

export type ThoughtPatternCategory = 'decision' | 'preference' | 'expertise' | 'reaction' | 'value' | 'process';

export interface OrgCognitiveSettings {
  enabled: boolean;
}

export interface CognitiveProfileExpertise {
  domain: string;
  depth: 'novice' | 'intermediate' | 'expert' | 'authority';
  confidence: number;
  evidence: string;
  lastObserved: string;
}

export interface CognitiveProfileData {
  communicationStyle: {
    formality: 'casual' | 'neutral' | 'formal';
    verbosity: 'concise' | 'balanced' | 'detailed';
    preferredFormats: string[];
  };
  decisionStyle: {
    approach: string;
    riskTolerance: 'conservative' | 'moderate' | 'aggressive';
    tendencies: string[];
  };
  expertise: CognitiveProfileExpertise[];
  values: string[];
  antiPatterns: string[];
  version: number;
  lastUpdatedAt: string;
  observationCount: number;
}

export interface ThoughtPatternRecord {
  id: string;
  pattern: string;
  category: ThoughtPatternCategory;
  sourceExcerpt: string;
  confidence: number;
  observationCount: number;
  lastReinforced: string;
}

export interface CognitiveProfileResponse {
  enabled: boolean;
  profile: CognitiveProfileData | null;
  patternCount: number;
}

export interface GovernanceStats {
  totalViolations: number;
  openViolations: number;
  bySeverity: Record<GovernanceSeverity, number>;
  byDay: Array<{ date: string; count: number }>;
  topPolicies: Array<{ policyId: string; policyName: string; count: number }>;
}
