import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: {
    chatWithFallback: vi.fn(),
  },
}));

import { classifyMessage } from './task-detector.js';
import { providerRegistry } from '../llm/provider-registry.js';

const mockChatWithFallback = providerRegistry.chatWithFallback as ReturnType<typeof vi.fn>;

/**
 * Helper: make the mock LLM return a classification result.
 */
function mockLLMResponse(result: {
  actionable: boolean;
  confidence: number;
  title: string;
  description: string;
}) {
  const json = JSON.stringify(result);
  mockChatWithFallback.mockReturnValue(
    (async function* () {
      yield { type: 'text_delta' as const, content: json };
      yield { type: 'done' as const, usage: { inputTokens: 100, outputTokens: 50 } };
    })(),
  );
}

describe('task-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classifyMessage', () => {
    it('skips LLM for trivially short messages', async () => {
      const result = await classifyMessage('ok');
      expect(result.actionable).toBe(false);
      expect(mockChatWithFallback).not.toHaveBeenCalled();
    });

    it('skips LLM for reaction-only messages', async () => {
      const result = await classifyMessage('lol');
      expect(result.actionable).toBe(false);
      expect(mockChatWithFallback).not.toHaveBeenCalled();
    });

    it('calls LLM for substantive messages', async () => {
      mockLLMResponse({
        actionable: true,
        confidence: 0.92,
        title: 'Review the pull request',
        description: 'Review the PR and fix failing tests by EOD',
      });

      const result = await classifyMessage(
        'Can you please review the pull request and fix the failing tests by EOD',
      );
      expect(result.actionable).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.title).toBe('Review the pull request');
      expect(mockChatWithFallback).toHaveBeenCalledOnce();
    });

    it('classifies informational messages as non-actionable', async () => {
      mockLLMResponse({
        actionable: false,
        confidence: 0.15,
        title: '',
        description: '',
      });

      const result = await classifyMessage('FYI, the build passed successfully');
      expect(result.actionable).toBe(false);
    });

    it('passes source context to LLM', async () => {
      mockLLMResponse({
        actionable: true,
        confidence: 0.85,
        title: 'Update deployment config',
        description: 'Update the CI config before the release',
      });

      await classifyMessage('Update the CI config before the release', {
        channel: '#engineering',
        from: 'alice',
        source: 'slack',
      });

      const callArgs = mockChatWithFallback.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('Channel: #engineering');
      expect(callArgs.messages[0].content).toContain('Source: slack');
    });

    it('handles LLM returning markdown-fenced JSON', async () => {
      const json = JSON.stringify({
        actionable: true,
        confidence: 0.88,
        title: 'Fix the login page',
        description: 'Login page is broken on mobile',
      });
      mockChatWithFallback.mockReturnValue(
        (async function* () {
          yield { type: 'text_delta' as const, content: '```json\n' + json + '\n```' };
          yield { type: 'done' as const, usage: { inputTokens: 100, outputTokens: 50 } };
        })(),
      );

      const result = await classifyMessage('The login page is broken on mobile');
      expect(result.actionable).toBe(true);
      expect(result.title).toBe('Fix the login page');
    });

    it('handles malformed LLM response gracefully', async () => {
      mockChatWithFallback.mockReturnValue(
        (async function* () {
          yield { type: 'text_delta' as const, content: 'not valid json at all' };
          yield { type: 'done' as const, usage: { inputTokens: 100, outputTokens: 50 } };
        })(),
      );

      const result = await classifyMessage('Some message that causes weird output');
      expect(result.actionable).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });
});
