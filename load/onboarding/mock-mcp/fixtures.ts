/**
 * Realistic fixtures for the mock MCP data source.
 *
 * These are shaped to match exactly what Hearth's synthesis-service and
 * work-intake backfill expect to read back from the MCP tools:
 *   - slack_search_messages → { messages: [{ text, user, username, channel, ts }] }
 *   - gmail_search          → { messages: [{ id, threadId, snippet, from }] }
 *   - granola_get_recent_transcripts → { meetings: [{ id, title, date, transcript:[{speaker,text}] }] }
 *
 * Several entries are deliberately ACTIONABLE (contain a request / task / action
 * item) so Hearth's task detector creates tasks from them; others are chatter so
 * we also prove the detector discriminates.
 */

export interface SlackMessageFixture {
  text: string;
  user: string;
  username: string;
  channel: string;
  ts: string;
}

export interface GmailMessageFixture {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
}

export interface GranolaSegment {
  speaker: string;
  text: string;
}

export interface GranolaMeetingFixture {
  id: string;
  title: string;
  date: string;
  transcript: GranolaSegment[];
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const SLACK_MESSAGES: SlackMessageFixture[] = [
  {
    // ACTIONABLE — explicit request
    text: 'Can you review the PR for the billing webhook refactor before the release on Friday? It is blocking the deploy.',
    user: 'U100',
    username: 'priya',
    channel: 'engineering',
    ts: hoursAgo(2),
  },
  {
    // ACTIONABLE — implicit bug to fix
    text: 'The onboarding checklist is rendering blank for brand-new accounts on mobile Safari. We need to fix this before the Product Hunt launch.',
    user: 'U101',
    username: 'marcus',
    channel: 'bugs',
    ts: hoursAgo(4),
  },
  {
    // chatter — not actionable
    text: 'lol nice, the demo went great 🎉',
    user: 'U102',
    username: 'dana',
    channel: 'general',
    ts: hoursAgo(5),
  },
];

export const GMAIL_MESSAGES: GmailMessageFixture[] = [
  {
    id: 'gmail-msg-001',
    threadId: 'gmail-thread-001',
    // ACTIONABLE — vendor wants a signed doc back
    snippet:
      'Hi — please send over the signed MSA and the updated security questionnaire by end of week so we can finalize the enterprise contract.',
    from: 'legal@acme-vendor.com',
  },
  {
    id: 'gmail-msg-002',
    threadId: 'gmail-thread-002',
    // chatter — informational newsletter
    snippet: 'Your weekly digest: 4 new followers and 12 profile views this week.',
    from: 'noreply@socialnetwork.com',
  },
];

export const GRANOLA_MEETINGS: GranolaMeetingFixture[] = [
  {
    id: 'granola-mtg-001',
    title: 'Q3 Launch Readiness Sync',
    date: hoursAgo(6),
    transcript: [
      { speaker: 'Priya', text: 'Where are we on the integration backfill work?' },
      {
        speaker: 'Marcus',
        // ACTIONABLE action item captured in a meeting
        text: 'Action item: I will write the migration to backfill memory for existing users by Wednesday.',
      },
      {
        speaker: 'Dana',
        // ACTIONABLE — assigns an owner a task
        text: 'We also decided someone needs to draft the launch comms email and get it approved by marketing before Thursday.',
      },
      { speaker: 'Priya', text: 'Great, thanks everyone. Good progress this week.' },
    ],
  },
];
