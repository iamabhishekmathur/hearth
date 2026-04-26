import type { ChatEvent, NormalizedEvent } from '@hearth/shared';
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
