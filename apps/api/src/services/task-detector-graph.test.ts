/**
 * Integration tests for task-detector → graph edge landing.
 *
 * Verifies that when a Task is auto-detected from an external message
 * (Slack, email, etc.), the detector also lands:
 *   - a Person row for the message author (upserted by integration handle)
 *   - an Edge: Task → produced_by → Person
 *   - an Edge: Task → discussed_in → external_ref(provider thread/channel)
 *
 * All external boundaries are mocked: LLM, prisma, websocket, dedup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: {
    chatWithFallback: vi.fn(),
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    task: { update: vi.fn().mockResolvedValue({ id: 't_1' }) },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

vi.mock('./intake-deduplicator.js', () => ({
  checkDuplicate: vi.fn().mockResolvedValue(false),
}));

vi.mock('../ws/socket-manager.js', () => ({
  emitToUser: vi.fn(),
}));

vi.mock('./task-service.js', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 't_new' }),
}));

vi.mock('./person-service.js', () => ({
  upsertPersonFromHandle: vi.fn(),
}));

vi.mock('./graph-service.js', () => ({
  upsertEdge: vi.fn(),
}));

import { providerRegistry } from '../llm/provider-registry.js';
import { detectAndCreateTask } from './task-detector.js';
import * as taskService from './task-service.js';
import * as personService from './person-service.js';
import * as graphService from './graph-service.js';
import { checkDuplicate } from './intake-deduplicator.js';

const mockChat = providerRegistry.chatWithFallback as ReturnType<typeof vi.fn>;
const mockCreateTask = taskService.createTask as ReturnType<typeof vi.fn>;
const mockUpsertPerson = personService.upsertPersonFromHandle as ReturnType<typeof vi.fn>;
const mockUpsertEdge = graphService.upsertEdge as ReturnType<typeof vi.fn>;
const mockCheckDuplicate = checkDuplicate as ReturnType<typeof vi.fn>;

function mockActionable(title = 'Review the PR', description = 'Review the PR') {
  mockChat.mockReturnValue(
    (async function* () {
      yield {
        type: 'text_delta' as const,
        content: JSON.stringify({
          actionable: true,
          confidence: 0.92,
          title,
          description,
        }),
      };
      yield { type: 'done' as const, usage: { inputTokens: 0, outputTokens: 0 } };
    })(),
  );
}

function mockNotActionable() {
  mockChat.mockReturnValue(
    (async function* () {
      yield {
        type: 'text_delta' as const,
        content: JSON.stringify({
          actionable: false,
          confidence: 0.05,
          title: '',
          description: '',
        }),
      };
      yield { type: 'done' as const, usage: { inputTokens: 0, outputTokens: 0 } };
    })(),
  );
}

const ORG = 'org_1';
const USER = 'u_1';

function slackMessage(overrides: Record<string, unknown> = {}) {
  return {
    source: 'slack' as const,
    text: 'Hey can you review the auth PR before Friday',
    from: 'alice',
    messageId: 'M123',
    channel: 'C_engineering',
    snippet: 'review the auth PR',
    userId: USER,
    orgId: ORG,
    fromHandle: { provider: 'slack' as const, externalId: 'U_alice', displayName: 'Alice' },
    threadRef: { provider: 'slack' as const, externalId: 'T_thread_abc' },
    ...overrides,
  };
}

describe('task-detector → graph edge landing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckDuplicate.mockResolvedValue(false);
    mockCreateTask.mockResolvedValue({ id: 't_new' });
    mockUpsertPerson.mockResolvedValue({ id: 'p_alice', orgId: ORG });
    mockUpsertEdge.mockResolvedValue({ id: 'e_1' });
  });

  describe('happy path: Slack message → Task + Person + Edges', () => {
    it('upserts a Person for the Slack author', async () => {
      mockActionable();

      await detectAndCreateTask(slackMessage());

      expect(mockUpsertPerson).toHaveBeenCalledOnce();
      const call = mockUpsertPerson.mock.calls[0];
      expect(call[0]).toBe(ORG);
      expect(call[1]).toMatchObject({ slackUserId: 'U_alice', displayName: 'Alice' });
    });

    it('lands a produced_by edge from Task to Person', async () => {
      mockActionable();

      await detectAndCreateTask(slackMessage());

      const producedByCall = mockUpsertEdge.mock.calls.find(
        (c) => c[0].kind === 'produced_by',
      );
      expect(producedByCall).toBeDefined();
      expect(producedByCall![0]).toMatchObject({
        orgId: ORG,
        fromType: 'task',
        fromId: 't_new',
        toType: 'person',
        toId: 'p_alice',
        kind: 'produced_by',
        source: 'slack_webhook',
      });
    });

    it('lands a discussed_in edge from Task to external_ref(slack thread)', async () => {
      mockActionable();

      await detectAndCreateTask(slackMessage());

      const discussedInCall = mockUpsertEdge.mock.calls.find(
        (c) => c[0].kind === 'discussed_in',
      );
      expect(discussedInCall).toBeDefined();
      expect(discussedInCall![0]).toMatchObject({
        orgId: ORG,
        fromType: 'task',
        fromId: 't_new',
        toType: 'external_ref',
        kind: 'discussed_in',
        externalRef: { provider: 'slack', externalId: 'T_thread_abc' },
      });
    });

    it('returns created=true with the new task id', async () => {
      mockActionable();
      const result = await detectAndCreateTask(slackMessage());
      expect(result).toEqual({ created: true, taskId: 't_new' });
    });
  });

  describe('skip paths: edges should NOT be landed', () => {
    it('does not upsert Person or Edges when message is non-actionable', async () => {
      mockNotActionable();
      await detectAndCreateTask(slackMessage());

      expect(mockUpsertPerson).not.toHaveBeenCalled();
      expect(mockUpsertEdge).not.toHaveBeenCalled();
    });

    it('does not upsert Person or Edges when message is a duplicate', async () => {
      mockActionable();
      mockCheckDuplicate.mockResolvedValue(true);

      await detectAndCreateTask(slackMessage());

      expect(mockUpsertPerson).not.toHaveBeenCalled();
      expect(mockUpsertEdge).not.toHaveBeenCalled();
    });

    it('does not upsert Person or Edges when task creation fails', async () => {
      mockActionable();
      mockCreateTask.mockRejectedValue(new Error('db down'));

      const result = await detectAndCreateTask(slackMessage());

      expect(result.created).toBe(false);
      expect(mockUpsertPerson).not.toHaveBeenCalled();
      expect(mockUpsertEdge).not.toHaveBeenCalled();
    });
  });

  describe('partial-handle scenarios', () => {
    it('still creates the Task even when fromHandle is missing (no person/edges)', async () => {
      mockActionable();
      const msg = slackMessage({ fromHandle: undefined });

      const result = await detectAndCreateTask(msg);

      expect(result.created).toBe(true);
      expect(mockUpsertPerson).not.toHaveBeenCalled();
      // discussed_in can still land if threadRef is present
      const producedBy = mockUpsertEdge.mock.calls.find((c) => c[0].kind === 'produced_by');
      expect(producedBy).toBeUndefined();
    });

    it('still creates the Task even when threadRef is missing (no discussed_in)', async () => {
      mockActionable();
      const msg = slackMessage({ threadRef: undefined });

      await detectAndCreateTask(msg);

      const discussedIn = mockUpsertEdge.mock.calls.find((c) => c[0].kind === 'discussed_in');
      expect(discussedIn).toBeUndefined();
      // produced_by can still land
      const producedBy = mockUpsertEdge.mock.calls.find((c) => c[0].kind === 'produced_by');
      expect(producedBy).toBeDefined();
    });

    it('does not fail the whole detection when edge landing throws', async () => {
      mockActionable();
      mockUpsertEdge.mockRejectedValue(new Error('edge db error'));

      const result = await detectAndCreateTask(slackMessage());

      // Task is still created; edge failure is logged but non-fatal
      expect(result.created).toBe(true);
      expect(result.taskId).toBe('t_new');
    });

    it('supports email handles in addition to slack', async () => {
      mockActionable();
      const msg = slackMessage({
        source: 'email' as const,
        fromHandle: { provider: 'email' as const, externalId: 'alice@example.com', displayName: 'Alice' },
        threadRef: { provider: 'email' as const, externalId: 'thread_email_123' },
      });

      await detectAndCreateTask(msg);

      expect(mockUpsertPerson).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({ email: 'alice@example.com' }),
      );
    });
  });
});
