import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    org: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    cognitiveProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
    },
    thoughtPattern: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

vi.mock('./audit-service.js', () => ({
  logAudit: vi.fn(),
}));

import {
  isCognitiveEnabledForOrg,
  isCognitiveEnabledForUser,
  extractCognitivePatterns,
  searchThoughtPatterns,
  loadCognitiveProfile,
  setCognitiveEnabled,
  getCognitiveEnabled,
  rebuildCognitiveProfile,
} from './cognitive-profile-service.js';
import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { generateEmbedding } from './embedding-service.js';

// Helper to create a mock async generator from events
function mockStream(events: Array<Record<string, unknown>>) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })() as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Gating Tests ──

describe('isCognitiveEnabledForOrg', () => {
  it('returns false when org has no cognitive settings', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: {}, name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    expect(await isCognitiveEnabledForOrg('org-1')).toBe(false);
  });

  it('returns false when cognitive profiles are explicitly disabled', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: { cognitiveProfiles: { enabled: false } },
      name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    expect(await isCognitiveEnabledForOrg('org-1')).toBe(false);
  });

  it('returns true when cognitive profiles are enabled', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: { cognitiveProfiles: { enabled: true } },
      name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    expect(await isCognitiveEnabledForOrg('org-1')).toBe(true);
  });
});

describe('isCognitiveEnabledForUser', () => {
  it('returns false when org feature is disabled', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: {}, name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    expect(await isCognitiveEnabledForUser('org-1', 'user-1')).toBe(false);
  });

  it('returns true when org enabled and no user profile record (default opt-in)', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: { cognitiveProfiles: { enabled: true } },
      name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue(null);
    expect(await isCognitiveEnabledForUser('org-1', 'user-1')).toBe(true);
  });

  it('returns false when user has opted out', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: { cognitiveProfiles: { enabled: true } },
      name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue({
      id: 'cp-1', orgId: 'org-1', userId: 'user-1', profile: {},
      version: 1, enabled: false, createdAt: new Date(), updatedAt: new Date(),
    });
    expect(await isCognitiveEnabledForUser('org-1', 'user-1')).toBe(false);
  });
});

// ── Extraction Tests ──

describe('extractCognitivePatterns', () => {
  it('skips extraction when feature is disabled', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: {}, name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });

    await extractCognitivePatterns({
      sessionId: 'sess-1', userId: 'user-1', orgId: 'org-1',
    });

    // Should not even load messages
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it('skips extraction when session is too short', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: { cognitiveProfiles: { enabled: true } },
      name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue(null);

    // Only 1 user message (below threshold of 3)
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([
      { id: 'm1', sessionId: 'sess-1', role: 'user', content: 'hello', metadata: {}, createdBy: null, createdAt: new Date() },
      { id: 'm2', sessionId: 'sess-1', role: 'assistant', content: 'hi there', metadata: {}, createdBy: null, createdAt: new Date() },
    ]);

    await extractCognitivePatterns({
      sessionId: 'sess-1', userId: 'user-1', orgId: 'org-1',
    });

    // Should not call LLM
    expect(providerRegistry.chatWithFallback).not.toHaveBeenCalled();
  });

  it('extracts patterns from qualifying session', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: 'org-1', settings: { cognitiveProfiles: { enabled: true } },
      name: '', slug: '', ssoConfig: null, createdAt: new Date(),
    });
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue(null);

    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([
      { id: 'm1', sessionId: 'sess-1', role: 'user', content: 'I prefer React over Vue', metadata: {}, createdBy: null, createdAt: new Date() },
      { id: 'm2', sessionId: 'sess-1', role: 'assistant', content: 'Interesting choice', metadata: {}, createdBy: null, createdAt: new Date() },
      { id: 'm3', sessionId: 'sess-1', role: 'user', content: 'Hooks are just better', metadata: {}, createdBy: null, createdAt: new Date() },
      { id: 'm4', sessionId: 'sess-1', role: 'assistant', content: 'Makes sense', metadata: {}, createdBy: null, createdAt: new Date() },
      { id: 'm5', sessionId: 'sess-1', role: 'user', content: 'Always choose simplicity', metadata: {}, createdBy: null, createdAt: new Date() },
    ]);

    const extractionResult = JSON.stringify({
      patterns: [
        {
          pattern: 'When choosing frontend frameworks, prefers React over Vue due to hooks',
          category: 'preference',
          confidence: 0.8,
          excerpt: 'I prefer React over Vue',
        },
      ],
      profileUpdates: { expertiseMentioned: [], valuesRevealed: ['simplicity'], communicationTraits: {} },
      contradictions: [],
    });

    vi.mocked(providerRegistry.chatWithFallback).mockReturnValue(
      mockStream([
        { type: 'text_delta', content: extractionResult },
        { type: 'done' },
      ]),
    );

    // No embedding for dedup = create directly
    vi.mocked(generateEmbedding).mockResolvedValue(null);
    vi.mocked(prisma.thoughtPattern.create).mockResolvedValue({
      id: 'tp-1', orgId: 'org-1', userId: 'user-1',
      pattern: 'test', category: 'preference',
      sourceSessionId: 'sess-1', sourceExcerpt: 'test',
      confidence: 0.8, observationCount: 1,
      firstObserved: new Date(), lastReinforced: new Date(),
      supersededById: null, supersededReason: null, createdAt: new Date(),
    });
    vi.mocked(prisma.thoughtPattern.count).mockResolvedValue(1);

    await extractCognitivePatterns({
      sessionId: 'sess-1', userId: 'user-1', orgId: 'org-1',
    });

    expect(providerRegistry.chatWithFallback).toHaveBeenCalled();
    expect(prisma.thoughtPattern.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'preference',
          orgId: 'org-1',
          userId: 'user-1',
        }),
      }),
    );
  });
});

// ── Search Tests ──

describe('searchThoughtPatterns', () => {
  it('falls back to text search when embedding is not available', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue(null);
    vi.mocked(prisma.thoughtPattern.findMany).mockResolvedValue([
      {
        id: 'tp-1', pattern: 'test pattern', category: 'preference',
        sourceExcerpt: 'quote', confidence: 0.8, observationCount: 2,
        lastReinforced: new Date(), orgId: 'org-1', userId: 'user-1',
        sourceSessionId: 'sess-1', firstObserved: new Date(),
        supersededById: null, supersededReason: null, createdAt: new Date(),
      },
    ]);

    const results = await searchThoughtPatterns('user-1', 'org-1', 'test query');
    expect(results).toHaveLength(1);
    expect(results[0].pattern).toBe('test pattern');
  });

  it('uses vector search when embedding is available', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        id: 'tp-1', pattern: 'vector result', category: 'decision',
        sourceExcerpt: 'quote', confidence: 0.9, observationCount: 5,
        lastReinforced: new Date(), score: 0.95,
      },
    ]);

    const results = await searchThoughtPatterns('user-1', 'org-1', 'decision making');
    expect(results).toHaveLength(1);
    expect(results[0].pattern).toBe('vector result');
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
  });
});

// ── Profile Load Tests ──

describe('loadCognitiveProfile', () => {
  it('returns null when no profile exists', async () => {
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue(null);
    const result = await loadCognitiveProfile('user-1', 'org-1');
    expect(result).toBeNull();
  });

  it('returns null when profile is disabled', async () => {
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue({
      id: 'cp-1', orgId: 'org-1', userId: 'user-1', profile: { test: true },
      version: 1, enabled: false, createdAt: new Date(), updatedAt: new Date(),
    });
    const result = await loadCognitiveProfile('user-1', 'org-1');
    expect(result).toBeNull();
  });

  it('returns profile data when enabled', async () => {
    const profileData = {
      communicationStyle: { formality: 'casual', verbosity: 'concise', preferredFormats: [] },
      decisionStyle: { approach: 'pragmatic', riskTolerance: 'moderate', tendencies: [] },
      expertise: [],
      values: ['simplicity'],
      antiPatterns: [],
      version: 1,
      lastUpdatedAt: '2026-04-19T00:00:00Z',
      observationCount: 10,
    };
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue({
      id: 'cp-1', orgId: 'org-1', userId: 'user-1', profile: profileData,
      version: 1, enabled: true, createdAt: new Date(), updatedAt: new Date(),
    });
    const result = await loadCognitiveProfile('user-1', 'org-1');
    expect(result).toEqual(profileData);
  });
});

// ── Opt-Out Tests ──

describe('setCognitiveEnabled / getCognitiveEnabled', () => {
  it('upserts cognitive profile enabled status', async () => {
    vi.mocked(prisma.cognitiveProfile.upsert).mockResolvedValue({
      id: 'cp-1', orgId: 'org-1', userId: 'user-1', profile: {},
      version: 1, enabled: false, createdAt: new Date(), updatedAt: new Date(),
    });
    await setCognitiveEnabled('user-1', 'org-1', false);
    expect(prisma.cognitiveProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { enabled: false },
      }),
    );
  });

  it('returns true when no profile exists (default opt-in)', async () => {
    vi.mocked(prisma.cognitiveProfile.findUnique).mockResolvedValue(null);
    const result = await getCognitiveEnabled('user-1', 'org-1');
    expect(result).toBe(true);
  });
});
