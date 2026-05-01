import { logger } from '../lib/logger.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { deliver } from './delivery-service.js';
import * as taskService from './task-service.js';

interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  description?: string;
  location?: string;
}

export type MeetingPrepCadence = 'morning_digest' | '24h_before' | '1h_before' | 'realtime' | 'off';

const VALID_CADENCES: readonly MeetingPrepCadence[] = ['morning_digest', '24h_before', '1h_before', 'realtime', 'off'];
const DEFAULT_CADENCE: MeetingPrepCadence = '1h_before';

/**
 * Get user's meeting prep cadence preference.
 */
export function getUserCadence(preferences: Record<string, unknown>): MeetingPrepCadence {
  const cadence = preferences?.meetingPrepCadence;
  if (typeof cadence === 'string' && (VALID_CADENCES as readonly string[]).includes(cadence)) {
    return cadence as MeetingPrepCadence;
  }
  return DEFAULT_CADENCE;
}

/**
 * Check if a meeting should get a prep nudge based on cadence.
 */
export function shouldSendPrepNow(
  meetingStart: Date,
  cadence: MeetingPrepCadence,
  now: Date = new Date(),
): boolean {
  if (cadence === 'off') return false;

  const diffMs = meetingStart.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  switch (cadence) {
    case 'morning_digest':
      // Send between 8-9am on the day of the meeting
      return now.getHours() >= 8 && now.getHours() < 9 && diffHours > 0 && diffHours < 14;
    case '24h_before':
      return diffHours > 23 && diffHours < 25;
    case '1h_before':
      return diffHours > 0.5 && diffHours < 1.5;
    case 'realtime':
      return diffHours > 0 && diffHours < 0.25;
    default:
      return false;
  }
}

/**
 * Generate meeting prep materials using the agent.
 */
export async function generateMeetingPrep(
  userId: string,
  event: CalendarEvent,
): Promise<string> {
  try {
    const context = await buildAgentContext(userId, `meeting-prep-${event.id}`);

    const attendeeList = event.attendees
      ?.map((a) => a.displayName ?? a.email)
      .join(', ') ?? 'No attendees listed';

    const prompt = [
      `Prepare me for this upcoming meeting:`,
      `Title: ${event.summary}`,
      `Time: ${event.start.dateTime ?? event.start.date}`,
      `Attendees: ${attendeeList}`,
      event.description ? `Description: ${event.description}` : '',
      event.location ? `Location: ${event.location}` : '',
      '',
      'Please provide:',
      '1. Key context about the attendees (from memory if available)',
      '2. Relevant talking points',
      '3. Any action items or follow-ups from previous interactions',
    ]
      .filter(Boolean)
      .join('\n');

    let output = '';
    for await (const agentEvent of agentLoop(context, [{ role: 'user', content: prompt }])) {
      if (agentEvent.type === 'text_delta') {
        output += agentEvent.content;
      }
    }

    return output;
  } catch (err) {
    logger.error({ err, eventId: event.id }, 'Failed to generate meeting prep');
    return `Meeting: ${event.summary}\nUnable to generate full prep materials.`;
  }
}

/**
 * Create a task from an accepted meeting prep nudge.
 */
export async function acceptPrepNudge(
  orgId: string,
  userId: string,
  eventSummary: string,
  prepContent: string,
) {
  return taskService.createTask(orgId, userId, {
    title: `Prep: ${eventSummary}`,
    description: prepContent,
    source: 'meeting',
  });
}

/**
 * Deliver a meeting prep nudge to the user.
 */
export async function deliverPrepNudge(
  userId: string,
  event: CalendarEvent,
  prepContent: string,
) {
  await deliver({
    userId,
    title: `Meeting prep: ${event.summary}`,
    body: prepContent.slice(0, 500),
    entityType: 'meeting',
    entityId: event.id,
    channels: ['in_app'],
    metadata: {
      eventSummary: event.summary,
      eventStart: event.start.dateTime ?? event.start.date,
      prepContent,
    },
  });
}
