import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import { logger } from '../../lib/logger.js';

const GCALENDAR_TOOLS: ToolDefinition[] = [
  {
    name: 'gcalendar_list_events',
    description: 'List upcoming calendar events',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max events to return', default: 10 },
        timeMin: { type: 'string', description: 'Start time (ISO 8601)' },
        timeMax: { type: 'string', description: 'End time (ISO 8601)' },
      },
    },
  },
  {
    name: 'gcalendar_get_event',
    description: 'Get details of a specific calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Event ID' },
      },
      required: ['eventId'],
    },
  },
];

export class GCalendarConnector implements MCPConnector {
  readonly provider = 'gcalendar';
  private connected = false;
  private accessToken = '';

  async connect(config: ConnectorConfig): Promise<void> {
    if (!config.credentials['access_token']) {
      throw new Error('Google Calendar connector requires access_token credential');
    }
    this.accessToken = config.credentials['access_token'];
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = '';
  }

  listTools(): ToolDefinition[] {
    return GCALENDAR_TOOLS;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.accessToken) {
      return { output: { message: 'Google Calendar not connected. Configure in Settings.' } };
    }

    switch (toolName) {
      case 'gcalendar_list_events': {
        const timeMin = (input.timeMin as string) ?? new Date().toISOString();
        const timeMax = (input.timeMax as string) ??
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const maxResults = (input.maxResults as number) ?? 10;

        try {
          const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
          url.searchParams.set('timeMin', timeMin);
          url.searchParams.set('timeMax', timeMax);
          url.searchParams.set('maxResults', String(maxResults));
          url.searchParams.set('singleEvents', 'true');
          url.searchParams.set('orderBy', 'startTime');

          const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${this.accessToken}` },
          });
          const data = await res.json() as Record<string, unknown>;

          if (data.error) {
            return { output: { message: `Calendar API error: ${JSON.stringify(data.error)}` } };
          }

          const items = (data.items as Array<Record<string, unknown>>) ?? [];
          return {
            output: {
              events: items.map((e) => ({
                id: e.id,
                summary: e.summary,
                start: e.start,
                end: e.end,
                attendees: e.attendees,
                location: e.location,
                description: e.description,
              })),
            },
          };
        } catch (err) {
          logger.error({ err }, 'Failed to list calendar events');
          return { output: { message: 'Failed to list events' }, error: String(err) };
        }
      }

      case 'gcalendar_get_event': {
        try {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${input.eventId}`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } },
          );
          const data = await res.json() as Record<string, unknown>;
          return { output: data };
        } catch (err) {
          return { output: { message: 'Failed to get event' }, error: String(err) };
        }
      }

      default:
        return { output: { message: `Unknown tool: ${toolName}` } };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.accessToken) return false;
    try {
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary',
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
