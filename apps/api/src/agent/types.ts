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
