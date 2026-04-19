import type { NormalizedEvent } from '@hearth/shared';

/**
 * Normalizes provider-specific webhook payloads into a common NormalizedEvent format.
 */
export function normalizeEvent(provider: string, eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  switch (provider) {
    case 'github':
      return normalizeGitHub(eventType, payload);
    case 'jira':
      return normalizeJira(eventType, payload);
    case 'notion':
      return normalizeNotion(eventType, payload);
    case 'slack':
      return normalizeSlack(eventType, payload);
    case 'granola':
      return normalizeGranola(eventType, payload);
    case 'otter':
      return normalizeOtter(eventType, payload);
    case 'fireflies':
      return normalizeFireflies(eventType, payload);
    default:
      return {
        provider,
        eventType,
        payload,
        receivedAt: new Date().toISOString(),
      };
  }
}

function normalizeGitHub(eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  const action = payload.action as string | undefined;
  const fullEventType = action ? `${eventType}.${action}` : eventType;

  const sender = payload.sender as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  let resource: NormalizedEvent['resource'];

  if (eventType === 'pull_request' || eventType === 'pull_request_review') {
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    if (pr) {
      resource = {
        type: 'pull_request',
        id: String(pr.number),
        title: pr.title as string,
        url: pr.html_url as string,
      };
    }
  } else if (eventType === 'issues') {
    const issue = payload.issue as Record<string, unknown> | undefined;
    if (issue) {
      resource = {
        type: 'issue',
        id: String(issue.number),
        title: issue.title as string,
        url: issue.html_url as string,
      };
    }
  } else if (eventType === 'push') {
    resource = {
      type: 'push',
      id: (payload.after as string)?.slice(0, 8) ?? '',
      title: `Push to ${(payload.ref as string)?.replace('refs/heads/', '')}`,
    };
  }

  // Truncate payload to avoid oversized storage
  const truncatedPayload: Record<string, unknown> = {};
  if (repo) truncatedPayload.repository = { full_name: repo.full_name, html_url: repo.html_url };
  if (resource) truncatedPayload.resource = resource;
  truncatedPayload.action = action;

  return {
    provider: 'github',
    eventType: fullEventType,
    actor: sender?.login as string | undefined,
    resource,
    payload: truncatedPayload,
    receivedAt: new Date().toISOString(),
  };
}

function normalizeJira(eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  const user = payload.user as Record<string, unknown> | undefined;
  const issue = payload.issue as Record<string, unknown> | undefined;

  let resource: NormalizedEvent['resource'];
  if (issue) {
    resource = {
      type: 'issue',
      id: issue.key as string,
      title: (issue.fields as Record<string, unknown>)?.summary as string,
    };
  }

  return {
    provider: 'jira',
    eventType: (payload.webhookEvent as string) ?? eventType,
    actor: user?.displayName as string | undefined,
    resource,
    payload: { issue: issue ? { key: issue.key, summary: (issue.fields as Record<string, unknown>)?.summary } : undefined },
    receivedAt: new Date().toISOString(),
  };
}

function normalizeNotion(eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  return {
    provider: 'notion',
    eventType,
    payload: { type: payload.type, id: payload.id },
    receivedAt: new Date().toISOString(),
  };
}

function normalizeSlack(eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  const event = payload.event as Record<string, unknown> | undefined;
  return {
    provider: 'slack',
    eventType: event?.type as string ?? eventType,
    actor: event?.user as string | undefined,
    payload: { channel: event?.channel, text: event?.text },
    receivedAt: new Date().toISOString(),
  };
}

function normalizeGranola(eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  return {
    provider: 'granola',
    eventType: eventType || 'meeting.completed',
    resource: {
      type: 'meeting',
      id: (payload.meeting_id as string) ?? '',
      title: (payload.title as string) ?? 'Meeting',
    },
    payload: {
      title: payload.title,
      transcript: payload.transcript,
      summary: payload.summary,
      participants: payload.participants,
      meetingDate: payload.start_time ?? payload.meeting_date,
    },
    receivedAt: new Date().toISOString(),
  };
}

function normalizeOtter(eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  return {
    provider: 'otter',
    eventType: eventType || 'meeting.completed',
    resource: {
      type: 'meeting',
      id: (payload.speech_id as string) ?? (payload.id as string) ?? '',
      title: (payload.title as string) ?? 'Meeting',
    },
    payload: {
      title: payload.title,
      transcript: payload.transcript ?? payload.text,
      summary: payload.summary,
      participants: payload.speakers ?? payload.participants,
      meetingDate: payload.created_at ?? payload.start_time,
    },
    receivedAt: new Date().toISOString(),
  };
}

function normalizeFireflies(eventType: string, payload: Record<string, unknown>): NormalizedEvent {
  return {
    provider: 'fireflies',
    eventType: eventType || 'meeting.completed',
    resource: {
      type: 'meeting',
      id: (payload.meeting_id as string) ?? (payload.id as string) ?? '',
      title: (payload.title as string) ?? 'Meeting',
    },
    payload: {
      title: payload.title,
      transcript: payload.transcript ?? payload.sentences,
      summary: payload.summary ?? payload.overview,
      participants: payload.participants ?? payload.attendees,
      meetingDate: payload.date ?? payload.start_time,
    },
    receivedAt: new Date().toISOString(),
  };
}
