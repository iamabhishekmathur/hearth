import { createHash } from 'node:crypto';
import type { ChatEvent, LLMMessage, StopReason, ToolDefinition, ToolPermissionLevel } from '@hearth/shared';
import { providerRegistry } from '../llm/provider-registry.js';
import { resolveModel, UnknownModelError } from '../llm/model-catalog.js';
import { executeTool } from './tool-router.js';
import type { AgentContext, ToolResult } from './types.js';
import { getUsageRecorder } from '../extensions/usage-metering.js';
import {
  evaluateToolCall,
  loadPolicyRules,
  persistUserAllowRule,
  type PermissionDecisionResult,
} from './permission-policy.js';
import { PLAN_PROFILE_ID } from './agent-profiles.js';
import { awaitPermission } from './run-registry.js';
import { logAudit } from '../services/audit-service.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// Default per-run budgets, used when the caller doesn't set one on
// AgentContext. The hard `throw` at the iteration cap is gone — at the cap we
// do a graceful toolless summary instead (see below). CrewAI defaults to 25.
const DEFAULT_MAX_ITERATIONS = 25;
// Fallback model used ONLY when neither the request nor the org specifies one.
// It is still validated through `resolveModel`, so an unknown id surfaces as an
// error — never a silent swap (kills the undated `claude-haiku-4-5` bug).
const FALLBACK_MODEL = 'claude-sonnet-4-6';
// Doom-loop: this many identical tool fingerprints in a row = stuck.
const DOOM_LOOP_THRESHOLD = 3;

/**
 * The main agent loop. Sends messages to the LLM, handles tool calls, and
 * yields ChatEvent events as an async generator.
 *
 * W2 (opencode adaptation) adds:
 * - interruptibility: `context.abortSignal` is threaded into the provider and
 *   tool execution, and checked between iterations and before each tool call.
 *   On abort the loop stops cleanly and emits `done{stopReason:'interrupted'}`.
 * - configurable budgets: `context.maxIterations` / `context.maxTokens`.
 * - doom-loop detection: 3 identical tool fingerprints → warning + graceful
 *   toolless summary (no runaway cost).
 * - graceful degradation: at the iteration cap, same toolless summary instead
 *   of throwing.
 * - validated model resolution: `resolveModel` replaces the silent fallback.
 */
export async function* agentLoop(
  context: AgentContext,
  messages: LLMMessage[],
): AsyncGenerator<ChatEvent> {
  const signal = context.abortSignal;
  const maxIterations = context.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxTokens = context.maxTokens; // undefined = no token budget

  // ── Validated model resolution (replaces DEFAULT_MODEL + silent fallback) ──
  // Chain: request model (context.model) → org default → built-in fallback.
  // Every candidate is validated against the catalog; an unknown id raises a
  // typed error that we surface to the UI rather than silently answering on a
  // different model.
  let model: string;
  try {
    model = await resolveRunModel(context);
  } catch (err) {
    if (err instanceof UnknownModelError) {
      yield { type: 'error', message: `Unknown model '${err.modelId}'. Pick a model from the catalog.` };
      yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' };
      return;
    }
    throw err;
  }

  // If the caller handed us an already-aborted signal, finish immediately.
  if (signal?.aborted) {
    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'interrupted' };
    return;
  }

  // Filter out unavailable tools before sending to LLM
  const availableTools = context.tools.filter((t) => !t.isAvailable || t.isAvailable());

  const toolDefs: ToolDefinition[] = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  // Build tool handler map for execution (only available tools)
  const toolMap = new Map(availableTools.map((t) => [t.name, t]));

  const conversationMessages: LLMMessage[] = [...messages];

  // Cumulative token usage across iterations (for the maxTokens budget).
  let cumulativeTokens = 0;
  // Doom-loop fingerprint tracking.
  let lastFingerprint: string | null = null;
  let repeatCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Abort check between iterations.
    if (signal?.aborted) {
      yield { type: 'done', usage: { inputTokens: cumulativeTokens, outputTokens: 0 }, stopReason: 'interrupted' };
      return;
    }
    // Token-budget check between iterations.
    if (maxTokens !== undefined && cumulativeTokens >= maxTokens) {
      yield { type: 'warning', message: `Token budget (${maxTokens}) reached. Summarizing progress.` };
      yield* gracefulSummary(context, conversationMessages, model, 'budget', signal, cumulativeTokens);
      return;
    }

    const pendingToolCalls: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];
    const inputBuffers = new Map<string, string>(); // tool call id → accumulated JSON
    let hasToolCalls = false;
    let fullTextContent = '';
    let lastUsage = { inputTokens: 0, outputTokens: 0 };

    // Stream from LLM
    const stream = providerRegistry.chatWithFallback(
      {
        model,
        messages: conversationMessages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        systemPrompt: context.systemPrompt,
        sessionId: context.sessionId,
        signal,
      },
      context.providerId,
    );

    for await (const event of stream) {
      switch (event.type) {
        case 'thinking':
        case 'text_delta':
          if (event.type === 'text_delta') {
            fullTextContent += event.content;
          }
          yield event;
          break;

        case 'tool_call_start':
          hasToolCalls = true;
          pendingToolCalls.push({ id: event.id, name: event.tool, input: {} });
          inputBuffers.set(event.id, '');
          yield event;
          break;

        case 'tool_call_delta':
          inputBuffers.set(event.id, (inputBuffers.get(event.id) ?? '') + event.input);
          yield event;
          break;

        case 'tool_call_end': {
          // Parse the accumulated JSON and update the pending tool call's input
          const jsonStr = inputBuffers.get(event.id) ?? '{}';
          const tc = pendingToolCalls.find((t) => t.id === event.id);
          if (tc) {
            try { tc.input = JSON.parse(jsonStr); } catch { tc.input = {}; }
          }
          inputBuffers.delete(event.id);
          yield event;
          break;
        }

        case 'error':
          yield event;
          yield { type: 'done', usage: lastUsage, stopReason: 'error' };
          return;

        case 'done':
          lastUsage = event.usage;
          break;
      }
    }

    cumulativeTokens += (lastUsage.inputTokens ?? 0) + (lastUsage.outputTokens ?? 0);

    // The provider may have been aborted mid-stream — it stops yielding, so we
    // land here with whatever partial text we accumulated. Persist the partial
    // and finalize as interrupted.
    if (signal?.aborted) {
      if (fullTextContent) {
        conversationMessages.push({ role: 'assistant', content: fullTextContent });
      }
      yield { type: 'done', usage: lastUsage, stopReason: 'interrupted' };
      return;
    }

    // If no tool calls, we're done (normal completion).
    if (!hasToolCalls) {
      if (fullTextContent) {
        conversationMessages.push({ role: 'assistant', content: fullTextContent });
      }
      recordAgentRunUsage(context.orgId);
      yield { type: 'done', usage: lastUsage, stopReason: 'done' };
      return;
    }

    // Execute tool calls and add results to conversation
    const assistantMessage: LLMMessage = {
      role: 'assistant',
      content: fullTextContent,
      toolCalls: pendingToolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input })),
    };
    conversationMessages.push(assistantMessage);

    // Abort check *before* firing any tool. If the user steered/stopped while
    // the model was choosing tools, discard the tool calls rather than trigger
    // side-effects, and finalize as interrupted.
    if (signal?.aborted) {
      yield { type: 'done', usage: lastUsage, stopReason: 'interrupted' };
      return;
    }

    // ── W3: per-tool permission gate ──
    // Before firing any tool, consult the policy for each call. `deny` short-
    // circuits to a `blocked_by_policy` tool result (the model adapts). `ask`
    // emits a `permission_request` and PARKS the run on a per-callId promise
    // until the client replies (or the ask times out → deny). `allow` runs.
    // All of this is gated behind `permissionsEnabled`; when off the tools run
    // unconditionally (today's behavior). Permission resolution is sequential
    // (asks queue by callId, in order); the ALLOWED tools then run in parallel.
    // W4: plan mode's read-only guarantee is enforced through this SAME W3
    // policy path — so even when the W3 `permissions` flag is OFF, a plan run
    // must still consult the policy to deny writes. We therefore gate on
    // `permissionsEnabled` OR an active plan profile.
    const planModeActive = context.agentProfileId === PLAN_PROFILE_ID;
    const policyRules = context.permissionsEnabled || planModeActive
      ? await loadPolicyRules({
          orgId: context.orgId,
          agentProfileId: context.agentProfileId,
          userId: context.userId,
        })
      : null;

    // Decide per tool call. `deny`/timeout produce a blocked result inline;
    // allowed calls are collected for parallel execution.
    const blockedResults: Array<{ toolCall: typeof pendingToolCalls[number]; result: ToolResult; durationMs: number }> = [];
    const toRun: typeof pendingToolCalls = [];

    for (const toolCall of pendingToolCalls) {
      // Yield 'started' progress up front (keeps the UI's tool card in sync
      // whether the call ends up allowed, denied, or awaiting approval).
      yield { type: 'tool_progress', toolCallId: toolCall.id, toolName: toolCall.name, status: 'started' as const };

      if (!policyRules) {
        toRun.push(toolCall);
        continue;
      }

      let decision: PermissionDecisionResult = evaluateToolCall({
        toolName: toolCall.name,
        input: toolCall.input,
        userRules: policyRules.userRules,
        agentRules: policyRules.agentRules,
        orgRules: policyRules.orgRules,
      });

      if (decision.level === 'ask') {
        // Emit the request and park until the client answers / timeout / abort.
        yield { type: 'permission_request', callId: toolCall.id, tool: toolCall.name, input: toolCall.input };
        const outcome = await awaitPermission({
          callId: toolCall.id,
          runId: context.runId ?? context.sessionId,
          timeoutMs: context.permissionTimeoutMs,
          signal,
        });
        // Map the client decision back to a concrete level.
        const resolved: ToolPermissionLevel =
          outcome === 'allow_once' || outcome === 'allow_always' ? 'allow' : 'deny';
        if (outcome === 'allow_always') {
          // Persist a user-scope allow rule so the next identical call auto-allows.
          await persistUserAllowRule({
            orgId: context.orgId,
            userId: context.userId,
            toolName: toolCall.name,
            createdBy: context.userId,
          });
        }
        void auditPermissionDecision(context, toolCall.name, 'ask', outcome);
        decision = { ...decision, level: resolved };
      } else if (decision.level === 'deny') {
        void auditPermissionDecision(context, toolCall.name, 'deny', decision.nonOverridable ? 'org_deny' : 'deny');
      }

      if (decision.level === 'deny') {
        // Blocked — return a tool result the model can adapt to (never a silent
        // drop). Distinguish the hard org deny for the UI/model.
        blockedResults.push({
          toolCall,
          result: {
            output: {
              error: 'blocked_by_policy',
              reason: decision.nonOverridable
                ? 'This tool is blocked by an organization policy and cannot be used.'
                : 'The user declined to allow this tool call.',
            },
            error: 'blocked_by_policy',
          },
          durationMs: 0,
        });
      } else {
        toRun.push(toolCall);
      }
    }

    // Abort may have fired while a permission ask was parked. If so, discard
    // everything and finalize interrupted (no side-effects after a stop).
    if (signal?.aborted) {
      yield { type: 'done', usage: lastUsage, stopReason: 'interrupted' };
      return;
    }

    // Execute the ALLOWED tool calls in parallel, honoring the abort signal.
    const ranResults = await Promise.all(
      toRun.map(async (toolCall) => {
        const startTime = Date.now();
        const result = await executeTool(toolCall.name, toolCall.input, toolMap, context.userId, signal);
        const durationMs = Date.now() - startTime;
        return { toolCall, result, durationMs };
      }),
    );

    // Merge blocked + ran results, preserving the original call order so the
    // conversation's tool_result messages line up with the assistant's calls.
    const resultsById = new Map<string, { toolCall: typeof pendingToolCalls[number]; result: ToolResult; durationMs: number }>();
    for (const r of blockedResults) resultsById.set(r.toolCall.id, r);
    for (const r of ranResults) resultsById.set(r.toolCall.id, r);
    const toolResults = pendingToolCalls.map((tc) => resultsById.get(tc.id)!);

    // Yield completion progress and add results to conversation
    for (const { toolCall, result, durationMs } of toolResults) {
      yield {
        type: 'tool_progress',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        status: result.error ? 'failed' as const : 'completed' as const,
        durationMs,
      };

      if (!result.error && hasExternalSideEffect(toolCall.name)) {
        yield { type: 'side_effect', toolName: toolCall.name, provider: extractProvider(toolCall.name) };
      }

      conversationMessages.push({
        role: 'tool',
        content: result.error
          ? JSON.stringify({ error: result.error, ...result.output })
          : JSON.stringify(result.output),
        toolCallId: toolCall.id,
      });
    }

    // ── Doom-loop detection ──
    // Fingerprint this iteration by its tool calls + inputs + result hashes.
    // Three identical fingerprints in a row means the agent is stuck repeating
    // the same action; break out with a warning + graceful summary.
    const fingerprint = fingerprintIteration(toolResults);
    if (fingerprint === lastFingerprint) {
      repeatCount += 1;
    } else {
      repeatCount = 1;
      lastFingerprint = fingerprint;
    }
    if (repeatCount >= DOOM_LOOP_THRESHOLD) {
      yield { type: 'warning', message: 'Detected a repeating tool-call loop — stopping tool use and summarizing.' };
      yield* gracefulSummary(context, conversationMessages, model, 'done', signal, cumulativeTokens);
      return;
    }

    // Continue the loop — LLM will process tool results
  }

  // Hit max iterations — graceful toolless summary (no hard throw).
  yield { type: 'warning', message: `Reached the maximum of ${maxIterations} steps. Summarizing progress.` };
  yield* gracefulSummary(context, conversationMessages, model, 'max_iterations', signal, cumulativeTokens);
}

/**
 * Resolve the model id for a run through the validated chain and return the id.
 * Throws `UnknownModelError` for any explicitly-requested-but-unknown id.
 */
async function resolveRunModel(context: AgentContext): Promise<string> {
  // 1. Explicit request model — if provided it MUST be valid (no silent swap).
  if (context.model) {
    resolveModel(context.model); // throws UnknownModelError if unknown
    return context.model;
  }
  // 2. Org default (if configured). Also validated.
  const orgDefault = await getOrgDefaultModel(context.orgId);
  if (orgDefault) {
    resolveModel(orgDefault); // throws if the org has a stale/bad default
    return orgDefault;
  }
  // 3. Built-in fallback — still validated against the catalog.
  resolveModel(FALLBACK_MODEL);
  return FALLBACK_MODEL;
}

/** Read `org.settings.defaultModel` if set. Best-effort; null on any failure. */
async function getOrgDefaultModel(orgId: string): Promise<string | null> {
  try {
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
    const settings = (org?.settings as Record<string, unknown> | null) ?? {};
    const def = settings.defaultModel;
    return typeof def === 'string' && def.length > 0 ? def : null;
  } catch {
    return null;
  }
}

/**
 * One final toolless LLM call that asks the model to summarize progress and
 * what remains. Used for doom-loop breaks, the iteration cap, and the token
 * budget. Honors the abort signal; finishes with `done{stopReason}`.
 */
async function* gracefulSummary(
  context: AgentContext,
  conversationMessages: LLMMessage[],
  model: string,
  stopReason: StopReason,
  signal: AbortSignal | undefined,
  priorTokens: number,
): AsyncGenerator<ChatEvent> {
  if (signal?.aborted) {
    yield { type: 'done', usage: { inputTokens: priorTokens, outputTokens: 0 }, stopReason: 'interrupted' };
    return;
  }

  conversationMessages.push({
    role: 'user',
    content:
      'You have reached a stopping point and cannot call any more tools. Summarize what you accomplished so far and what still remains to be done. Do not call any tools.',
  });

  const finalStream = providerRegistry.chatWithFallback(
    {
      model,
      messages: conversationMessages,
      systemPrompt: context.systemPrompt,
      signal,
      // No tools — force a text-only response.
    },
    context.providerId,
  );

  let finalUsage = { inputTokens: 0, outputTokens: 0 };
  for await (const event of finalStream) {
    if (event.type === 'text_delta') yield event;
    else if (event.type === 'error') {
      yield event;
      yield { type: 'done', usage: finalUsage, stopReason: 'error' };
      return;
    } else if (event.type === 'done') finalUsage = event.usage;
  }

  // If we were aborted while streaming the summary, report interrupted.
  if (signal?.aborted) {
    yield { type: 'done', usage: finalUsage, stopReason: 'interrupted' };
    return;
  }

  recordAgentRunUsage(context.orgId);
  yield {
    type: 'done',
    usage: { inputTokens: finalUsage.inputTokens + priorTokens, outputTokens: finalUsage.outputTokens },
    stopReason,
  };
}

/**
 * Build a stable fingerprint for one iteration's tool activity:
 * hash(tool_name + normalized input + result hash) across all tool calls in the
 * iteration, order-independent. Identical fingerprints across iterations means
 * the agent is repeating itself.
 */
function fingerprintIteration(
  toolResults: Array<{
    toolCall: { name: string; input: Record<string, unknown> };
    result: { output: Record<string, unknown>; error?: string };
  }>,
): string {
  const parts = toolResults
    .map(({ toolCall, result }) => {
      const input = stableStringify(toolCall.input);
      const resultHash = createHash('sha1')
        .update(result.error ? `err:${result.error}` : stableStringify(result.output))
        .digest('hex');
      return `${toolCall.name}|${input}|${resultHash}`;
    })
    .sort();
  return createHash('sha1').update(parts.join('\n')).digest('hex');
}

/** Deterministic JSON stringify (sorted keys) so equal inputs hash equally. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Fire-and-forget usage metering. No-op when no recorder is registered
 * (i.e. OSS self-hosting). Errors are logged but never propagated — a
 * metering glitch must never break an agent run.
 */
function recordAgentRunUsage(orgId: string): void {
  const recorder = getUsageRecorder();
  if (recorder) {
    recorder(orgId, 'agent_runs', 1).catch((err) => {
      logger.warn({ err, orgId }, 'usage metering failed');
    });
  }
}

// ────────────────────────────────────────────────────────────────────────
// Side-effect detection
//
// Heuristic: MCP tool calls (prefixed `mcp__provider__action`) whose
// action verb implies a write to an external system. We don't gate the
// call — the agent already ran it — but we surface a UI hint so the
// user can promote similar requests into tasks (with a review gate).
// ────────────────────────────────────────────────────────────────────────

const WRITE_VERBS = [
  'send', 'post', 'create', 'publish', 'write', 'add', 'update',
  'edit', 'comment', 'file', 'delete', 'remove', 'schedule', 'invite',
  'transition', 'move', 'merge', 'close', 'reply',
];

function hasExternalSideEffect(toolName: string): boolean {
  if (!toolName.startsWith('mcp__')) return false;
  const rest = toolName.slice('mcp__'.length).toLowerCase();
  return WRITE_VERBS.some((v) => rest.includes(v));
}

function extractProvider(toolName: string): string {
  const parts = toolName.split('__');
  return parts.length >= 2 ? parts[1] : 'integration';
}

/**
 * Audit a permission decision (W3). Every `ask` outcome and every `deny` writes
 * an `audit_logs` row with `action: 'tool_permission_decision'`. Fire-and-forget
 * — a failed audit never breaks the run (logAudit already swallows its own
 * errors). The `decision` is the concrete outcome: a ToolPermissionDecision for
 * asks, `'timeout'` for ask-timeouts, `'deny'`/`'org_deny'` for policy denials.
 */
async function auditPermissionDecision(
  context: AgentContext,
  toolName: string,
  gate: 'ask' | 'deny',
  decision: string,
): Promise<void> {
  await logAudit({
    orgId: context.orgId,
    userId: context.userId,
    action: 'tool_permission_decision',
    entityType: 'session',
    entityId: context.sessionId,
    details: {
      tool: toolName,
      gate,
      decision,
      runId: context.runId ?? null,
      agentMode: context.agentMode ?? null,
    },
  });
}
