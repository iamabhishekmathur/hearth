import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock slackService module
vi.mock('../../services/slack-service.js', () => ({
  postMessage: vi.fn(),
  listChannels: vi.fn(),
  searchMessages: vi.fn(),
}));

// Mock token-store decrypt
vi.mock('../token-store.js', () => ({
  decrypt: vi.fn((val: string) => `decrypted-${val}`),
}));

import { SlackConnector } from './slack-connector.js';
import * as slackService from '../../services/slack-service.js';
import { decrypt } from '../token-store.js';

const mockPostMessage = vi.mocked(slackService.postMessage);
const mockListChannels = vi.mocked(slackService.listChannels);
const mockSearchMessages = vi.mocked(slackService.searchMessages);
const mockDecrypt = vi.mocked(decrypt);

describe('SlackConnector', () => {
  let connector: SlackConnector;

  beforeEach(() => {
    connector = new SlackConnector();
    mockFetch.mockReset();
    mockPostMessage.mockReset();
    mockListChannels.mockReset();
    mockSearchMessages.mockReset();
    mockDecrypt.mockReset();
    mockDecrypt.mockImplementation((val: string) => `decrypted-${val}`);
  });

  describe('connect', () => {
    it('succeeds with valid bot_token', async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'xoxb-test-token' },
      });
      expect(connector.listTools().length).toBe(3);
    });

    it('throws with missing bot_token', async () => {
      await expect(
        connector.connect({ provider: 'slack', credentials: {} }),
      ).rejects.toThrow('Slack connector requires bot_token credential');
    });

    it('decrypts token when bot_token_encrypted is true', async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'encrypted-value', bot_token_encrypted: 'true' },
      });
      expect(mockDecrypt).toHaveBeenCalledWith('encrypted-value');
    });

    it('does not decrypt when bot_token_encrypted is not set', async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'xoxb-plaintext' },
      });
      expect(mockDecrypt).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('clears state and returns not-connected', async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'xoxb-test' },
      });
      await connector.disconnect();
      const result = await connector.executeTool('slack_post_message', {
        channel: '#general',
        text: 'hello',
      });
      expect(result.output).toHaveProperty('message');
    });
  });

  describe('listTools', () => {
    it('returns all 3 slack tools', () => {
      const tools = connector.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('slack_post_message');
      expect(names).toContain('slack_list_channels');
      expect(names).toContain('slack_search_messages');
    });
  });

  describe('executeTool', () => {
    beforeEach(async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'xoxb-test-token' },
      });
    });

    it('returns not-connected when disconnected', async () => {
      await connector.disconnect();
      const result = await connector.executeTool('slack_post_message', {
        channel: '#general',
        text: 'hi',
      });
      expect(result.output).toHaveProperty('message', 'Integration not yet connected. Configure in Settings.');
    });

    it('posts a message via slackService', async () => {
      mockPostMessage.mockResolvedValueOnce({
        ok: true,
        ts: '1234567890.123456',
      });

      const result = await connector.executeTool('slack_post_message', {
        channel: '#general',
        text: 'Hello team!',
      });

      expect(mockPostMessage).toHaveBeenCalledWith('xoxb-test-token', '#general', 'Hello team!');
      expect(result.output).toHaveProperty('message', 'Message posted');
      expect(result.output).toHaveProperty('ts', '1234567890.123456');
    });

    it('lists channels via slackService', async () => {
      mockListChannels.mockResolvedValueOnce([
        { id: 'C01', name: 'general', topic: { value: 'General chat' } },
        { id: 'C02', name: 'random', topic: { value: 'Random stuff' } },
      ] as Record<string, unknown>[]);

      const result = await connector.executeTool('slack_list_channels', { limit: 50 });

      expect(mockListChannels).toHaveBeenCalledWith('xoxb-test-token', 50);
      const channels = (result.output as Record<string, unknown>).channels as Array<Record<string, unknown>>;
      expect(channels).toHaveLength(2);
      expect(channels[0]).toEqual({ id: 'C01', name: 'general', topic: 'General chat' });
    });

    it('uses default limit for list_channels when not specified', async () => {
      mockListChannels.mockResolvedValueOnce([]);

      await connector.executeTool('slack_list_channels', {});

      expect(mockListChannels).toHaveBeenCalledWith('xoxb-test-token', 100);
    });

    it('searches messages via slackService', async () => {
      mockSearchMessages.mockResolvedValueOnce([
        { text: 'Found message', ts: '123' },
      ] as Record<string, unknown>[]);

      const result = await connector.executeTool('slack_search_messages', {
        query: 'deployment',
        limit: 5,
      });

      expect(mockSearchMessages).toHaveBeenCalledWith('xoxb-test-token', 'deployment', 5);
      expect(result.output).toHaveProperty('messages');
      const messages = (result.output as Record<string, unknown>).messages as Array<unknown>;
      expect(messages).toHaveLength(1);
    });

    it('uses default limit for search_messages', async () => {
      mockSearchMessages.mockResolvedValueOnce([]);

      await connector.executeTool('slack_search_messages', { query: 'test' });

      expect(mockSearchMessages).toHaveBeenCalledWith('xoxb-test-token', 'test', 20);
    });

    it('returns error for unknown tool', async () => {
      const result = await connector.executeTool('slack_unknown', {});
      expect(result.output).toHaveProperty('message', 'Unknown tool: slack_unknown');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not connected', async () => {
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns true when Slack API responds ok', async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'xoxb-test-token' },
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, user_id: 'U123' }),
      });
      expect(await connector.healthCheck()).toBe(true);
    });

    it('returns false when Slack API responds not ok', async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'xoxb-expired' },
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'invalid_auth' }),
      });
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns false on fetch error', async () => {
      await connector.connect({
        provider: 'slack',
        credentials: { bot_token: 'xoxb-test-token' },
      });
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      expect(await connector.healthCheck()).toBe(false);
    });
  });
});
