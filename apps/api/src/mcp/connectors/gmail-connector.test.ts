import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GmailConnector } from './gmail-connector.js';

describe('GmailConnector', () => {
  let connector: GmailConnector;

  beforeEach(() => {
    connector = new GmailConnector();
    mockFetch.mockReset();
  });

  describe('connect', () => {
    it('succeeds with valid credentials', async () => {
      await connector.connect({
        provider: 'gmail',
        credentials: { access_token: 'test-token' },
      });
      expect(connector.listTools().length).toBeGreaterThan(0);
    });

    it('throws with missing access_token', async () => {
      await expect(
        connector.connect({ provider: 'gmail', credentials: {} }),
      ).rejects.toThrow('Gmail connector requires access_token credential');
    });
  });

  describe('disconnect', () => {
    it('clears state', async () => {
      await connector.connect({
        provider: 'gmail',
        credentials: { access_token: 'test-token' },
      });
      await connector.disconnect();

      const result = await connector.executeTool('gmail_send_email', {
        to: 'a@b.com',
        subject: 'Hi',
        body: 'Hello',
      });
      expect(result.output.message).toContain('not connected');
    });
  });

  describe('listTools', () => {
    it('returns 3 tools', () => {
      const tools = connector.listTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual([
        'gmail_send_email',
        'gmail_search',
        'gmail_list_labels',
      ]);
    });
  });

  describe('executeTool', () => {
    it('returns error when not connected', async () => {
      const result = await connector.executeTool('gmail_send_email', {});
      expect(result.output.message).toContain('not connected');
    });

    describe('gmail_send_email', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'gmail',
          credentials: { access_token: 'test-token' },
        });
      });

      it('sends email successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'msg-123' }),
        });

        const result = await connector.executeTool('gmail_send_email', {
          to: 'user@example.com',
          subject: 'Test Subject',
          body: '<p>Hello</p>',
        });

        expect(result.output.message).toBe('Email sent');
        expect(result.output.messageId).toBe('msg-123');
        expect(mockFetch).toHaveBeenCalledWith(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          expect.objectContaining({ method: 'POST' }),
        );
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Unauthorized' } }),
        });

        const result = await connector.executeTool('gmail_send_email', {
          to: 'user@example.com',
          subject: 'Test',
          body: 'Hi',
        });

        expect(result.output.message).toContain('Gmail API error');
      });

      it('handles fetch failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await connector.executeTool('gmail_send_email', {
          to: 'user@example.com',
          subject: 'Test',
          body: 'Hi',
        });

        expect(result.output.message).toBe('Failed to send email');
        expect(result.error).toContain('Network error');
      });

      it('strips CRLF from to and subject to prevent header injection', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'msg-456' }),
        });

        await connector.executeTool('gmail_send_email', {
          to: "evil@example.com\r\nBcc: attacker@evil.com",
          subject: "Normal\r\nBcc: attacker@evil.com",
          body: 'Test',
        });

        // Verify the raw message has no CRLF-injected separate Bcc header line
        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body) as { raw: string };
        const decoded = Buffer.from(callBody.raw, 'base64url').toString();
        const headerSection = decoded.split('\r\n\r\n')[0];
        const headerLines = headerSection.split('\r\n');
        // Should only have To, Subject, Content-Type — no injected Bcc header
        expect(headerLines.every((l: string) => !l.startsWith('Bcc:'))).toBe(true);
      });
    });

    describe('gmail_search', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'gmail',
          credentials: { access_token: 'test-token' },
        });
      });

      it('searches messages successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
          }),
        });
        // Individual message fetches
        mockFetch.mockResolvedValueOnce({
          json: async () => ({
            id: 'msg-1',
            threadId: 'thread-1',
            snippet: 'Hello',
            payload: { headers: [] },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          json: async () => ({
            id: 'msg-2',
            threadId: 'thread-2',
            snippet: 'World',
            payload: { headers: [] },
          }),
        });

        const result = await connector.executeTool('gmail_search', {
          query: 'from:test',
          maxResults: 5,
        });

        const output = result.output as { messages: Array<{ id: string }> };
        expect(output.messages).toHaveLength(2);
        expect(output.messages[0].id).toBe('msg-1');
      });

      it('handles API error on list', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Bad request' } }),
        });

        const result = await connector.executeTool('gmail_search', { query: 'test' });
        expect(result.output.message).toContain('Gmail API error');
      });

      it('handles empty results', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

        const result = await connector.executeTool('gmail_search', { query: 'nonexistent' });
        const output = result.output as { messages: unknown[] };
        expect(output.messages).toHaveLength(0);
      });
    });

    describe('gmail_list_labels', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'gmail',
          credentials: { access_token: 'test-token' },
        });
      });

      it('lists labels successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            labels: [
              { id: 'INBOX', name: 'INBOX' },
              { id: 'SENT', name: 'SENT' },
            ],
          }),
        });

        const result = await connector.executeTool('gmail_list_labels', {});
        const output = result.output as { labels: Array<{ id: string }> };
        expect(output.labels).toHaveLength(2);
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'forbidden' }),
        });

        const result = await connector.executeTool('gmail_list_labels', {});
        expect(result.output.message).toContain('Gmail API error');
      });
    });

    it('returns error for unknown tool', async () => {
      await connector.connect({
        provider: 'gmail',
        credentials: { access_token: 'test-token' },
      });

      const result = await connector.executeTool('gmail_unknown', {});
      expect(result.output.message).toContain('Unknown tool');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not connected', async () => {
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns true on successful API call', async () => {
      await connector.connect({
        provider: 'gmail',
        credentials: { access_token: 'test-token' },
      });

      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await connector.healthCheck()).toBe(true);
    });

    it('returns false on failed API call', async () => {
      await connector.connect({
        provider: 'gmail',
        credentials: { access_token: 'test-token' },
      });

      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns false on network error', async () => {
      await connector.connect({
        provider: 'gmail',
        credentials: { access_token: 'test-token' },
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      expect(await connector.healthCheck()).toBe(false);
    });
  });

  it('has provider set to gmail', () => {
    expect(connector.provider).toBe('gmail');
  });
});
