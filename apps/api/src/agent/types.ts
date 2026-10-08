import type { AgentMode, ChatEvent, NormalizedEvent } from '@hearth/shared';
import type { RoutineRunContext } from '../services/routine-context-service.js';
import type { CitationSource } from './system-prompt.js';

export interface AgentContext {
  userId: string;
  orgId: string;
  teamId: string | null;
  sessionId: string;
  model?: string;
  providerId?: string;
  latestMessage?: string;
  activeArtifactId?: string;
  timezone?: string;
  visionEnabled?: boolean;
  // ── Agent-loop modernization (opencode adaptation; see plans/) ──
  // W2: unique id for this run (cross-instance stop) + cancellation signal the
  // loop and providers honor, plus optional per-run budgets.
  runId?: string;
  abortSignal?: AbortSignal;
  maxIterations?: number;
  maxTokens?: number;
  // W4: plan vs build. Undefined is treated as 'build' (current behavior).
  agentMode?: AgentMode;
  // W4: in plan mode the `submit_plan` tool calls this with the structured plan
  // the agent produced, so the chat route can persist it on the assistant
  // message metadata (`metadata.plan`) and render the "Approve & Build" card.
  onPlanSubmitted?: (plan: AgentPlan) => void;
  // W4: an approved plan seeding a build run (rendered into the system prompt).
  approvedPlan?: AgentPlan;
  // ── W3: per-tool permission policy (opencode adaptation) ──
  // When `permissionsEnabled` is true the loop consults the policy before each
  // tool call: allow→run, deny→blocked_by_policy tool result, ask→emit a
  // `permission_request` ChatEvent and PARK on a per-callId promise until the
  // client replies (or the ask times out → treated as deny). When false (flag
  // off), tools run unconditionally — today's behavior. An optional agent
  // profile scopes agent-layer rules (Plan/Build, W4).
  permissionsEnabled?: boolean;
  agentProfileId?: string | null;
  /** Override the ask timeout (ms). Defaults to run-registry's default. */
  permissionTimeoutMs?: number;
  // Routine-specific context (Features 1, 2)
  routineRunContext?: RoutineRunContext;
  triggerEvent?: NormalizedEvent;
  routineId?: string;
  // Cognitive query context (Digital Co-Worker)
  cognitiveQuerySubjectId?: string;
  rollingSummary?: string;
  // These will be populated by context-builder
  systemPrompt: string;
  sources?: CitationSource[];
  tools: AgentTool[];
}

/** A single step of a plan-mode plan. */
export interface AgentPlanStep {
  /** 1-based step index. */
  index: number;
  /** One concrete, verifiable action. */
  text: string;
}

/**
 * The structured plan produced by a plan-mode run via the `submit_plan` tool.
 * Persisted to `chat_messages.metadata.plan` and consumed by "Approve & Build".
 */
export interface AgentPlan {
  steps: AgentPlanStep[];
  /** Optional one-line summary of what the plan accomplishes. */
  summary?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
  isAvailable?: () => boolean;
}

export interface ToolResult {
  output: Record<string, unknown>;
  error?: string;
}

// Re-export ChatEvent as AgentEvent for clarity
export type AgentEvent = ChatEvent;
