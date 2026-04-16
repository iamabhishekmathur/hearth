import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GCalendarConnector } from './gcalendar-connector.js';

describe('GCalendarConnector', () => {
  let connector: GCalendarConnector;

  beforeEach(() => {
    connector = new GCalendarConnector();
    mockFetch.mockReset();
  });

  describe('connect', () => {
    it('succeeds with valid credentials', async () => {
      await connector.connect({
        provider: 'gcalendar',
        credentials: { access_token: 'ya29.test-token' },
      });
      expect(connector.listTools().length).toBe(2);
    });

    it('throws with missing access_token', async () => {
      await expect(
        connector.connect({ provider: 'gcalendar', credentials: {} }),
      ).rejects.toThrow('Google Calendar connector requires access_token credential');
    });
  });

  describe('disconnect', () => {
    it('clears state and returns not-connected on subsequent calls', async () => {
      await connector.connect({
        provider: 'gcalendar',
        credentials: { access_token: 'ya29.test-token' },
      });
      await connector.disconnect();
      const result = await connector.executeTool('gcalendar_list_events', {});
      expect(result.output).toHaveProperty('message', 'Google Calendar not connected. Configure in Settings.');
    });
  });

  describe('listTools', () => {
    it('returns gcalendar_list_events and gcalendar_get_event', () => {
      const tools = connector.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('gcalendar_list_events');
      expect(names).toContain('gcalendar_get_event');
    });
  });

  describe('executeTool', () => {
    beforeEach(async () => {
      await connector.connect({
        provider: 'gcalendar',
        credentials: { access_token: 'ya29.test-token' },
      });
    });

    it('returns not-connected when disconnected', async () => {
      await connector.disconnect();
      const result = await connector.executeTool('gcalendar_list_events', {});
      expect(result.output).toHaveProperty('message');
    });

    it('lists events successfully', async () => {
      const mockEvents = [
        {
          id: 'evt1',
          summary: 'Team standup',
          start: { dateTime: '2026-04-14T09:00:00Z' },
          end: { dateTime: '2026-04-14T09:30:00Z' },
          attendees: [{ email: 'alice@example.com' }],
          location: 'Room A',
          description: 'Daily sync',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: mockEvents }),
      });

      const result = await connector.executeTool('gcalendar_list_events', {
        timeMin: '2026-04-14T00:00:00Z',
        timeMax: '2026-04-15T00:00:00Z',
        maxResults: 5,
      });

      expect(result.output).toHaveProperty('events');
      const events = (result.output as Record<string, unknown>).events as Array<Record<string, unknown>>;
      expect(events).toHaveLength(1);
      expect(events[0]).toHaveProperty('summary', 'Team standup');
      expect(events[0]).toHaveProperty('location', 'Room A');
    });

    it('handles API error in list_events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { code: 401, message: 'Invalid Credentials' } }),
      });

      const result = await connector.executeTool('gcalendar_list_events', {});
      expect(JSON.stringify(result.output)).toContain('Calendar API error');
    });

    it('handles empty event list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

      const result = await connector.executeTool('gcalendar_list_events', {});
      const events = (result.output as Record<string, unknown>).events as Array<unknown>;
      expect(events).toHaveLength(0);
    });

    it('handles fetch failure in list_events', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await connector.executeTool('gcalendar_list_events', {});
      expect(result.error).toBeDefined();
      expect(result.output).toHaveProperty('message', 'Failed to list events');
    });

    it('gets event by ID', async () => {
      const mockEvent = {
        id: 'evt1',
        summary: 'Sprint review',
        start: { dateTime: '2026-04-14T14:00:00Z' },
        end: { dateTime: '2026-04-14T15:00:00Z' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEvent,
      });

      const result = await connector.executeTool('gcalendar_get_event', { eventId: 'evt1' });
      expect(result.output).toHaveProperty('id', 'evt1');
      expect(result.output).toHaveProperty('summary', 'Sprint review');
    });

    it('handles fetch failure in get_event', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const result = await connector.executeTool('gcalendar_get_event', { eventId: 'evt1' });
      expect(result.error).toBeDefined();
      expect(result.output).toHaveProperty('message', 'Failed to get event');
    });

    it('returns error for unknown tool', async () => {
      const result = await connector.executeTool('gcalendar_unknown', {});
      expect(result.output).toHaveProperty('message', 'Unknown tool: gcalendar_unknown');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not connected', async () => {
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns true when API responds ok', async () => {
      await connector.connect({
        provider: 'gcalendar',
        credentials: { access_token: 'ya29.test-token' },
      });
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await connector.healthCheck()).toBe(true);
    });

    it('returns false when API responds not ok', async () => {
      await connector.connect({
        provider: 'gcalendar',
        credentials: { access_token: 'ya29.expired' },
      });
      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns false on fetch error', async () => {
      await connector.connect({
        provider: 'gcalendar',
        credentials: { access_token: 'ya29.test-token' },
      });
      mockFetch.mockRejectedValueOnce(new Error('DNS failure'));
      expect(await connector.healthCheck()).toBe(false);
    });
  });
});
