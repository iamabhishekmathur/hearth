import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatEvent, PermissionRule } from '@hearth/shared';
import type { AgentContext } from './types.js';

// ── W3 §5.1 cases 21, 22, 26 + J2 error branches, driven through agentLoop ──
//   - deny → blocked_by_policy + model continues (case 20 end-to-end)
//   - ask → permission_request emitted, parks, allow_once resumes (21)
//   - allow_always persists a user rule (22)
//   - ask-timeout → deny (J2)
//   - response-after-run-ended ignored (J2)
//   - concurrent asks queue independently by callId (J2)
//   - downstream tool failure after allow (J2)
//   - every ask/deny writes an audit row (26)

// Provider registry — streamed events are set per test.
vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: { chatWithFallback: vi.fn() },
}));

// Tool router — executeTool mock.
vi.mock('./tool-router.js', () => ({ executeTool: vi.fn() }));

// Model catalog — known set, throws on unknown.
vi.mock('../llm/model-catalog.js', () => {
  class UnknownModelError extends Error {
    readonly code = 'UNKNOWN_MODEL';
    constructor(public readonly modelId: string) {
      super(`Unknown model '${modelId}'`);
      this.name = 'UnknownModelError';
    }
  }
  const known = new Set(['claude-sonnet-4-6', 'claude-opus-4-8', 'gpt-4o']);
  return {
    UnknownModelError,
    resolveModel: vi.fn((id: string) => {
      if (!known.has(id)) throw new UnknownModelError(id);
      return { id, providerId: 'anthropic', contextWindow: 1_000_000, caps: { vision: true, tools: true, reasoning: true } };
    }),
  };
});

// Policy module — control the rule set + spy persistence. evaluateToolCall is
// the REAL implementation (we want its semantics); loadPolicyRules and
// persistUserAllowRule are stubbed. `vi.hoisted` makes the refs/spies available
// inside the hoisted mock factories.
const { rulesRef, persistSpy, auditSpy } = vi.hoisted(() => ({
  rulesRef: { orgRules: [] as PermissionRule[] },
  persistSpy: vi.fn(async () => {}),
  auditSpy: vi.fn(async () => {}),
}));
vi.mock('./permission-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./permission-policy.js')>();
  return {
    ...actual,
    loadPolicyRules: vi.fn(async () => ({ orgRules: rulesRef.orgRules, agentRules: [], userRules: [] })),
    persistUserAllowRule: persistSpy,
  };
});

// Audit — spy.
vi.mock('../services/audit-service.js', () => ({ logAudit: auditSpy }));

// Prisma — org default lookup (none).
vi.mock('../lib/prisma.js', () => ({
  prisma: { org: { findUnique: vi.fn(async () => ({ settings: {} })) } },
}));

vi.mock('../extensions/usage-metering.js', () => ({ getUsageRecorder: () => null }));
vi.mock('../config.js', () => ({ env: { REDIS_URL: 'redis://localhost:6379' } }));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { agentLoop } from './agent-runtime.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { executeTool } from './tool-router.js';
import { resolvePermission, __resetRunRegistryForTests } from './run-registry.js';

const mockedChat = vi.mocked(providerRegistry.chatWithFallback);
const mockedExecuteTool = vi.mocked(executeTool);

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    teamId: null,
    sessionId: 'session-1',
    runId: 'run-1',
    permissionsEnabled: true,
    systemPrompt: 'You are helpful.',
    tools: [tool('slack_post_message'), tool('recall_decisions'), tool('integration_delete')],
    ...overrides,
  };
}

function tool(name: string) {
  return { name, description: `${name} tool`, inputSchema: { type: 'object' }, handler: vi.fn() };
}

async function* streamEvents(events: ChatEvent[]): AsyncGenerator<ChatEvent> {
  for (const e of events) yield e;
}

// A tool-use turn followed by a plain-text completion turn.
function toolThenDone(toolName: string, callId = 'pc_1', input: Record<string, unknown> = { channel: '#sales', text: 'hi' }) {
  mockedChat
    .mockReturnValueOnce(
      streamEvents([
        { type: 'tool_call_start', id: callId, tool: toolName, input: {} },
        { type: 'tool_call_delta', id: callId, input: JSON.stringify(input) },
        { type: 'tool_call_end', id: callId },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 5 } },
      ]) as never,
    )
    .mockReturnValueOnce(
      streamEvents([
        { type: 'text_delta', content: 'done.' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 2 } },
      ]) as never,
    );
}

async function drain(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('agentLoop — W3 permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRunRegistryForTests();
    rulesRef.orgRules = [];
    mockedExecuteTool.mockResolvedValue({ output: { ok: true } });
  });

  it('flag OFF: tools run unconditionally, no permission_request, no gate (today\'s behavior)', async () => {
    rulesRef.orgRules = [{ toolPattern: 'slack_post_message', level: 'ask' }];
    toolThenDone('slack_post_message');
    const events = await drain(agentLoop(makeContext({ permissionsEnabled: false }), [{ role: 'user', content: 'post' }]));
    expect(events.find((e) => e.type === 'permission_request')).toBeUndefined();
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
  });

  it('case 20/J2: deny → blocked_by_policy tool result, tool NOT run, model continues', async () => {
    rulesRef.orgRules = [{ toolPattern: 'slack_post_message', level: 'deny' }];
    toolThenDone('slack_post_message');
    const events = await drain(agentLoop(makeContext(), [{ role: 'user', content: 'post' }]));
    // Tool never executed.
    expect(mockedExecuteTool).not.toHaveBeenCalled();
    // The loop made a SECOND provider call (continued after the block).
    expect(mockedChat).toHaveBeenCalledTimes(2);
    // Finished normally.
    const done = events.filter((e) => e.type === 'done').pop() as { stopReason?: string } | undefined;
    expect(done?.stopReason).toBe('done');
    // Audited a deny.
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'tool_permission_decision' }));
  });

  it('J2: non-overridable org deny is audited as org_deny', async () => {
    rulesRef.orgRules = [{ toolPattern: 'integration_*', level: 'deny', userScopeOverridable: false }];
    toolThenDone('integration_delete', 'pc_x', {});
    await drain(agentLoop(makeContext(), [{ role: 'user', content: 'nuke it' }]));
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ decision: 'org_deny' }) }),
    );
  });

  it('case 21: ask → permission_request emitted, parks, allow_once resumes and runs the tool', async () => {
    rulesRef.orgRules = [{ toolPattern: 'slack_post_message', level: 'ask' }];
    toolThenDone('slack_post_message', 'pc_1');

    const events: ChatEvent[] = [];
    const gen = agentLoop(makeContext(), [{ role: 'user', content: 'post' }]);

    // Pump until the permission_request is emitted (the loop then parks on it).
    const pump = (async () => {
      for await (const e of gen) events.push(e);
    })();

    // Wait for the ask to surface, then answer allow_once.
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'permission_request')).toBe(true);
    });
    const resolved = resolvePermission('pc_1', 'allow_once');
    expect(resolved).toBe(true);

    await pump;
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
    const done = events.filter((e) => e.type === 'done').pop() as { stopReason?: string };
    expect(done.stopReason).toBe('done');
    // The ask was audited.
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'tool_permission_decision' }));
  });

  it('case 22: allow_always persists a user-scope allow rule', async () => {
    rulesRef.orgRules = [{ toolPattern: 'slack_post_message', level: 'ask' }];
    toolThenDone('slack_post_message', 'pc_1');
    const events: ChatEvent[] = [];
    const gen = agentLoop(makeContext(), [{ role: 'user', content: 'post' }]);
    const pump = (async () => { for await (const e of gen) events.push(e); })();
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true));
    resolvePermission('pc_1', 'allow_always');
    await pump;
    expect(persistSpy).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', userId: 'user-1', toolName: 'slack_post_message' }),
    );
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
  });

  it('J2: ask-timeout → treated as deny, tool not run, run finalizes cleanly', async () => {
    rulesRef.orgRules = [{ toolPattern: 'slack_post_message', level: 'ask' }];
    toolThenDone('slack_post_message', 'pc_1');
    // Tiny timeout so the park resolves to deny without a response.
    const events = await drain(
      agentLoop(makeContext({ permissionTimeoutMs: 20 }), [{ role: 'user', content: 'post' }]),
    );
    expect(events.some((e) => e.type === 'permission_request')).toBe(true);
    expect(mockedExecuteTool).not.toHaveBeenCalled();
    const done = events.filter((e) => e.type === 'done').pop() as { stopReason?: string };
    expect(done.stopReason).toBe('done'); // continued toolless after the block
    // Timeout audited.
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ decision: 'timeout' }) }),
    );
  });

  it('J2: permission_response for an unknown/ended callId is ignored (no throw)', () => {
    // No parked ask exists — resolvePermission must be a safe no-op.
    expect(() => resolvePermission('pc_does_not_exist', 'allow_once')).not.toThrow();
    expect(resolvePermission('pc_does_not_exist', 'allow_once')).toBe(false);
  });

  it('J2: concurrent asks queue independently by callId; resolving one does not resolve the other', async () => {
    rulesRef.orgRules = [{ toolPattern: 'slack_post_message', level: 'ask' }];
    // One turn with TWO slack tool calls → two asks.
    mockedChat
      .mockReturnValueOnce(
        streamEvents([
          { type: 'tool_call_start', id: 'pc_a', tool: 'slack_post_message', input: {} },
          { type: 'tool_call_delta', id: 'pc_a', input: JSON.stringify({ channel: '#a', text: 'x' }) },
          { type: 'tool_call_end', id: 'pc_a' },
          { type: 'tool_call_start', id: 'pc_b', tool: 'slack_post_message', input: {} },
          { type: 'tool_call_delta', id: 'pc_b', input: JSON.stringify({ channel: '#b', text: 'y' }) },
          { type: 'tool_call_end', id: 'pc_b' },
          { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
        ]) as never,
      )
      .mockReturnValueOnce(
        streamEvents([
          { type: 'text_delta', content: 'ok' },
          { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
        ]) as never,
      );

    const events: ChatEvent[] = [];
    const gen = agentLoop(makeContext(), [{ role: 'user', content: 'post two' }]);
    const pump = (async () => { for await (const e of gen) events.push(e); })();

    // Wait for the FIRST ask. The loop parks on pc_a before emitting pc_b.
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'permission_request').length).toBeGreaterThanOrEqual(1));
    // Resolving pc_a un-parks the first; pc_b's ask then surfaces.
    resolvePermission('pc_a', 'allow_once');
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'permission_request').length).toBe(2));
    // Deny the second.
    resolvePermission('pc_b', 'deny');
    await pump;

    // pc_a ran, pc_b did not.
    const ranTools = mockedExecuteTool.mock.calls.map((c) => c[1]); // input objects
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
    expect(ranTools[0]).toMatchObject({ channel: '#a' });
  });

  it('J2: downstream tool failure after allow surfaces a tool error, agent continues', async () => {
    rulesRef.orgRules = [{ toolPattern: 'slack_post_message', level: 'ask' }];
    toolThenDone('slack_post_message', 'pc_1');
    // The MCP call fails after the user allows.
    mockedExecuteTool.mockResolvedValue({ output: { status: 500 }, error: 'unauthorized' });

    const events: ChatEvent[] = [];
    const gen = agentLoop(makeContext(), [{ role: 'user', content: 'post' }]);
    const pump = (async () => { for await (const e of gen) events.push(e); })();
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true));
    resolvePermission('pc_1', 'allow_once');
    await pump;

    // Tool ran and reported failed progress; the loop still completed.
    const failed = events.find((e) => e.type === 'tool_progress' && (e as { status?: string }).status === 'failed');
    expect(failed).toBeDefined();
    const done = events.filter((e) => e.type === 'done').pop() as { stopReason?: string };
    expect(done.stopReason).toBe('done');
  });

  it('case 26: an allow (no ask/deny) writes NO permission audit row', async () => {
    rulesRef.orgRules = [{ toolPattern: 'recall_*', level: 'allow' }];
    toolThenDone('recall_decisions', 'pc_1', { query: 'x' });
    await drain(agentLoop(makeContext(), [{ role: 'user', content: 'recall' }]));
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
