import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    chatMessage: {
      findMany: vi.fn(),
    },
    agentExperience: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    skill: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: {
    chatWithFallback: vi.fn(),
  },
}));

vi.mock('./embedding-service.js', () => ({
  generateEmbedding: vi.fn(),
}));

import { reflectOnSession, searchExperiences, createProposedSkill } from './experience-service.js';
import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { generateEmbedding } from './embedding-service.js';

// Helper to create a mock async generator from events
function mockStream(events: Array<{ type: string; content?: string; message?: string; usage?: object }>) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

// Cast mocks for convenience
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrismaAny = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──

describe('reflectOnSession', () => {
  it('skips trivial sessions with too few messages', async () => {
    mockPrismaAny.chatMessage.findMany.mockResolvedValue([
      { role: 'user', content: 'hello', metadata: {} },
      { role: 'assistant', content: 'hi there', metadata: {} },
    ]);

    await reflectOnSession({
      sessionId: 'sess-1',
      userId: 'user-1',
      orgId: 'org-1',
    });

    // Should not call the LLM
    expect(providerRegistry.chatWithFallback).not.toHaveBeenCalled();
  });

  it('creates an experience record for a meaningful session', async () => {
    // Session with enough messages and tool calls
    mockPrismaAny.chatMessage.findMany.mockResolvedValue([
      { role: 'user', content: 'Search for React docs', metadata: {} },
      { role: 'assistant', content: 'Let me search...', metadata: {} },
      { role: 'tool', content: '{"results": [...]}', metadata: {} },
      { role: 'tool', content: '{"results": [...]}', metadata: {} },
      { role: 'assistant', content: 'Here is what I found...', metadata: {} },
    ]);

    const reflectionResult = {
      taskSummary: 'User asked to search React documentation',
      approach: 'Used web_search to find official React docs',
      outcome: 'success',
      learnings: ['React docs are at react.dev'],
      toolsUsed: ['web_search'],
      tags: ['react', 'documentation'],
      quality: 0.9,
      shouldProposeSkill: false,
    };

    (providerRegistry.chatWithFallback as ReturnType<typeof vi.fn>).mockReturnValue(
      mockStream([
        { type: 'text_delta', content: JSON.stringify(reflectionResult) },
        { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } },
      ]),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);

    // No similar experience found
    mockPrismaAny.$queryRawUnsafe.mockResolvedValueOnce([]);

    // Create experience via raw query (returns id)
    mockPrismaAny.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'exp-1' }]);

    // enforceExperienceCap
    mockPrismaAny.agentExperience.count.mockResolvedValue(5);

    await reflectOnSession({
      sessionId: 'sess-2',
      userId: 'user-1',
      orgId: 'org-1',
      durationMs: 5000,
    });

    // Should have called LLM for reflection
    expect(providerRegistry.chatWithFallback).toHaveBeenCalledOnce();

    // Should have created an experience (via raw query)
    expect(mockPrismaAny.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('includes tool failures in reflection context', async () => {
    mockPrismaAny.chatMessage.findMany.mockResolvedValue([
      { role: 'user', content: 'Search Jira for ticket', metadata: {} },
      { role: 'assistant', content: 'Searching...', metadata: {} },
      { role: 'tool', content: '{"error": "Integration disconnected"}', metadata: {} },
      { role: 'tool', content: '{"error": "retry failed"}', metadata: {} },
      { role: 'assistant', content: 'Sorry, Jira is not connected', metadata: {} },
    ]);

    const reflectionResult = {
      taskSummary: 'User tried to search Jira but integration was disconnected',
      approach: 'Attempted Jira search which failed due to disconnected integration',
      outcome: 'failure',
      learnings: ['Check integration status before attempting Jira queries'],
      toolsUsed: ['jira_search'],
      tags: ['jira', 'integration-failure'],
      quality: 0.3,
      shouldProposeSkill: false,
    };

    (providerRegistry.chatWithFallback as ReturnType<typeof vi.fn>).mockReturnValue(
      mockStream([
        { type: 'text_delta', content: JSON.stringify(reflectionResult) },
        { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } },
      ]),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);
    mockPrismaAny.$queryRawUnsafe.mockResolvedValueOnce([]); // no similar
    mockPrismaAny.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'exp-2' }]); // create
    mockPrismaAny.agentExperience.count.mockResolvedValue(5);

    await reflectOnSession({
      sessionId: 'sess-3',
      userId: 'user-1',
      orgId: 'org-1',
      toolFailures: ['jira_search'],
    });

    // LLM was called with failure context appended
    const llmCall = (providerRegistry.chatWithFallback as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const messageContent = llmCall.messages[0].content;
    expect(messageContent).toContain('jira_search');
    expect(messageContent).toContain('failed during this session');
  });
});

describe('searchExperiences', () => {
  it('falls back to text search when embedding is unavailable', async () => {
    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    mockPrismaAny.agentExperience.findMany.mockResolvedValue([
      {
        id: 'exp-1',
        taskSummary: 'Searched React docs',
        approach: 'web_search',
        outcome: 'success',
        learnings: ['React docs at react.dev'],
        toolsUsed: ['web_search'],
        tags: ['react'],
        quality: 0.9,
        createdAt: new Date(),
      },
    ]);

    const results = await searchExperiences('user-1', 'org-1', 'React documentation');

    expect(results).toHaveLength(1);
    expect(results[0].taskSummary).toBe('Searched React docs');
    expect(mockPrismaAny.agentExperience.findMany).toHaveBeenCalled();
  });

  it('uses vector search when embedding is available', async () => {
    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);

    mockPrismaAny.$queryRawUnsafe.mockResolvedValue([
      {
        id: 'exp-1',
        taskSummary: 'Analyzed sales data',
        approach: 'code_execution with pandas',
        outcome: 'success',
        learnings: ['Use pandas for CSV analysis'],
        toolsUsed: ['code_execution'],
        tags: ['data-analysis'],
        quality: 0.95,
        createdAt: new Date(),
      },
    ]);

    const results = await searchExperiences('user-1', 'org-1', 'analyze sales spreadsheet');

    expect(results).toHaveLength(1);
    expect(results[0].taskSummary).toBe('Analyzed sales data');
    expect(mockPrismaAny.$queryRawUnsafe).toHaveBeenCalled();
  });
});

describe('createProposedSkill', () => {
  it('creates a draft skill', async () => {
    mockPrismaAny.skill.count.mockResolvedValue(0); // no proposals today
    mockPrismaAny.skill.findFirst.mockResolvedValue(null); // no duplicate
    mockPrismaAny.skill.create.mockResolvedValue({
      id: 'skill-1',
      name: 'Jira Sprint Summary',
    });

    const result = await createProposedSkill(
      'user-1',
      'org-1',
      'Jira Sprint Summary',
      'Summarize Jira sprint progress',
      '## When to use\nWhen user asks for sprint summary...',
    );

    expect(result.id).toBe('skill-1');
    expect(result.name).toBe('Jira Sprint Summary');
    expect(mockPrismaAny.skill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Jira Sprint Summary',
          status: 'draft',
          source: 'auto_generated',
        }),
      }),
    );
  });

  it('rejects when daily limit is reached', async () => {
    mockPrismaAny.skill.count.mockResolvedValue(5); // at limit

    await expect(
      createProposedSkill('user-1', 'org-1', 'Test', 'Test', 'Content'),
    ).rejects.toThrow('Daily skill proposal limit reached');
  });

  it('rejects duplicate skill names', async () => {
    mockPrismaAny.skill.count.mockResolvedValue(0);
    mockPrismaAny.skill.findFirst.mockResolvedValue({ id: 'existing', name: 'Test Skill' });

    await expect(
      createProposedSkill('user-1', 'org-1', 'Test Skill', 'Desc', 'Content'),
    ).rejects.toThrow('already exists');
  });
});
