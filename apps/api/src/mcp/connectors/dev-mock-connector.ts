import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';

/**
 * Dev-mode mock connector that returns realistic fake data for any provider.
 * Used when integrations are seeded with dummy credentials.
 */

// ─── Mock data per tool ─────────────────────────────────────────────────────

const MOCK_RESPONSES: Record<string, (input: Record<string, unknown>) => ToolResult> = {
  // Slack
  slack_post_message: (input) => ({
    output: {
      message: 'Message posted (mock)',
      channel: input.channel,
      ts: `${Date.now()}.000100`,
      text: input.text,
    },
  }),
  slack_list_channels: () => ({
    output: {
      channels: [
        { id: 'C001', name: 'general', topic: 'Company-wide announcements' },
        { id: 'C002', name: 'engineering', topic: 'Engineering discussion' },
        { id: 'C003', name: 'product', topic: 'Product updates and feedback' },
        { id: 'C004', name: 'random', topic: 'Non-work banter' },
        { id: 'C005', name: 'standup', topic: 'Daily standups' },
      ],
    },
  }),
  slack_search_messages: (input) => ({
    output: {
      messages: [
        {
          text: `Hey team, here's the latest update on ${input.query}`,
          user: 'U001',
          username: 'alice',
          channel: 'engineering',
          ts: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          text: `Following up on ${input.query} — we should discuss in our next sync`,
          user: 'U002',
          username: 'bob',
          channel: 'product',
          ts: new Date(Date.now() - 7200000).toISOString(),
        },
      ],
    },
  }),

  // Notion
  notion_search: (input) => ({
    output: {
      results: [
        {
          id: 'page-001',
          object: 'page',
          url: 'https://notion.so/page-001',
          properties: { title: { title: [{ plain_text: `${input.query} — Project Roadmap` }] } },
          last_edited_time: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 'page-002',
          object: 'page',
          url: 'https://notion.so/page-002',
          properties: { title: { title: [{ plain_text: `Meeting Notes: ${input.query}` }] } },
          last_edited_time: new Date(Date.now() - 172800000).toISOString(),
        },
        {
          id: 'db-001',
          object: 'database',
          url: 'https://notion.so/db-001',
          title: [{ plain_text: 'Sprint Tracker' }],
        },
      ],
    },
  }),
  notion_get_page: (input) => ({
    output: {
      page: {
        id: input.pageId,
        object: 'page',
        url: `https://notion.so/${input.pageId}`,
        properties: {
          title: { title: [{ plain_text: 'Q2 Planning Document' }] },
          status: { select: { name: 'In Progress' } },
        },
      },
      blocks: [
        {
          type: 'heading_2',
          heading_2: { rich_text: [{ plain_text: 'Overview' }] },
        },
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [{ plain_text: 'This document outlines our key initiatives for Q2, including the integration platform launch and the collaborative features rollout.' }],
          },
        },
        {
          type: 'heading_2',
          heading_2: { rich_text: [{ plain_text: 'Key Milestones' }] },
        },
        {
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ plain_text: 'Integration platform beta — April 20' }] },
        },
        {
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ plain_text: 'Collaborative sessions v1 — May 5' }] },
        },
      ],
    },
  }),
  notion_create_page: (input) => ({
    output: {
      message: 'Page created (mock)',
      id: `page-mock-${Date.now()}`,
      url: `https://notion.so/page-mock-${Date.now()}`,
      title: input.title,
    },
  }),

  // Google Calendar
  gcalendar_list_events: () => {
    const now = new Date();
    const events = [
      {
        id: 'evt-001',
        summary: 'Team Standup',
        start: { dateTime: new Date(now.getTime() + 3600000).toISOString() },
        end: { dateTime: new Date(now.getTime() + 4500000).toISOString() },
        attendees: [
          { email: 'alice@company.com', displayName: 'Alice' },
          { email: 'bob@company.com', displayName: 'Bob' },
        ],
      },
      {
        id: 'evt-002',
        summary: '1:1 with Manager',
        start: { dateTime: new Date(now.getTime() + 7200000).toISOString() },
        end: { dateTime: new Date(now.getTime() + 9000000).toISOString() },
        attendees: [{ email: 'manager@company.com', displayName: 'Sarah' }],
      },
      {
        id: 'evt-003',
        summary: 'Sprint Planning',
        start: { dateTime: new Date(now.getTime() + 86400000).toISOString() },
        end: { dateTime: new Date(now.getTime() + 90000000).toISOString() },
        attendees: [
          { email: 'alice@company.com', displayName: 'Alice' },
          { email: 'bob@company.com', displayName: 'Bob' },
          { email: 'charlie@company.com', displayName: 'Charlie' },
        ],
        location: 'Conference Room A',
      },
    ];
    return { output: { events } };
  },
  gcalendar_get_event: (input) => ({
    output: {
      id: input.eventId,
      summary: 'Team Standup',
      description: 'Daily sync to discuss progress and blockers',
      start: { dateTime: new Date().toISOString() },
      end: { dateTime: new Date(Date.now() + 900000).toISOString() },
      attendees: [
        { email: 'alice@company.com', displayName: 'Alice', responseStatus: 'accepted' },
        { email: 'bob@company.com', displayName: 'Bob', responseStatus: 'accepted' },
      ],
      location: 'Zoom',
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
    },
  }),

  // Gmail
  gmail_send_email: (input) => ({
    output: {
      message: 'Email sent (mock)',
      messageId: `msg-mock-${Date.now()}`,
      to: input.to,
      subject: input.subject,
    },
  }),
  gmail_search: (input) => ({
    output: {
      messages: [
        {
          id: 'msg-001',
          threadId: 'thread-001',
          snippet: `Re: ${input.query} — Thanks for the update, let's discuss tomorrow...`,
          payload: {
            headers: [
              { name: 'Subject', value: `Re: ${input.query}` },
              { name: 'From', value: 'alice@company.com' },
              { name: 'Date', value: new Date(Date.now() - 3600000).toISOString() },
            ],
          },
        },
        {
          id: 'msg-002',
          threadId: 'thread-002',
          snippet: `${input.query} weekly report — Here are the highlights from this week...`,
          payload: {
            headers: [
              { name: 'Subject', value: `${input.query} weekly report` },
              { name: 'From', value: 'reports@company.com' },
              { name: 'Date', value: new Date(Date.now() - 86400000).toISOString() },
            ],
          },
        },
      ],
    },
  }),
  gmail_list_labels: () => ({
    output: {
      labels: [
        { id: 'INBOX', name: 'INBOX', type: 'system' },
        { id: 'SENT', name: 'SENT', type: 'system' },
        { id: 'DRAFT', name: 'DRAFT', type: 'system' },
        { id: 'Label_1', name: 'Work', type: 'user' },
        { id: 'Label_2', name: 'Personal', type: 'user' },
        { id: 'Label_3', name: 'Follow Up', type: 'user' },
      ],
    },
  }),

  // GitHub
  github_list_repos: () => ({
    output: {
      repositories: [
        { name: 'hearth', full_name: 'org/hearth', description: 'AI productivity platform', stars: 42 },
        { name: 'docs', full_name: 'org/docs', description: 'Documentation site', stars: 12 },
      ],
    },
  }),
  github_list_issues: (input) => ({
    output: {
      issues: [
        {
          number: 42,
          title: 'Add collaborative editing support',
          state: 'open',
          labels: [{ name: 'feature' }, { name: 'priority:high' }],
          assignee: { login: 'alice' },
          created_at: new Date(Date.now() - 604800000).toISOString(),
        },
        {
          number: 41,
          title: `Fix ${input.repo ?? 'main'} build pipeline`,
          state: 'open',
          labels: [{ name: 'bug' }],
          assignee: { login: 'bob' },
          created_at: new Date(Date.now() - 172800000).toISOString(),
        },
      ],
    },
  }),
  github_create_issue: (input) => ({
    output: {
      message: 'Issue created (mock)',
      number: Math.floor(Math.random() * 100) + 50,
      title: input.title,
      url: `https://github.com/org/repo/issues/${Math.floor(Math.random() * 100) + 50}`,
    },
  }),
  github_list_pull_requests: () => ({
    output: {
      pull_requests: [
        {
          number: 15,
          title: 'feat: add routine scheduling UI',
          state: 'open',
          user: { login: 'abhishek' },
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
    },
  }),

  // Jira
  jira_search_issues: (input) => ({
    output: {
      issues: [
        {
          key: 'HEARTH-101',
          fields: {
            summary: `${input.jql ?? 'Task'}: implement feature`,
            status: { name: 'In Progress' },
            assignee: { displayName: 'Alice' },
            priority: { name: 'High' },
          },
        },
      ],
    },
  }),
  jira_get_issue: (input) => ({
    output: {
      key: input.issueKey ?? 'HEARTH-101',
      fields: {
        summary: 'Implement collaborative chat sharing',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Abhishek' },
        description: 'Add ability for team members to share and collaborate on chat sessions.',
      },
    },
  }),
  jira_create_issue: (input) => ({
    output: {
      message: 'Issue created (mock)',
      key: `HEARTH-${Math.floor(Math.random() * 100) + 200}`,
      summary: input.summary,
    },
  }),

  // Google Drive
  gdrive_search_files: (input) => ({
    output: {
      files: [
        {
          id: 'file-001',
          name: `${input.query} — Shared Document.docx`,
          mimeType: 'application/vnd.google-apps.document',
          webViewLink: 'https://docs.google.com/document/d/file-001',
          modifiedTime: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
    },
  }),
  gdrive_get_file: (input) => ({
    output: {
      id: input.fileId,
      name: 'Project Spec.docx',
      mimeType: 'application/vnd.google-apps.document',
      webViewLink: `https://docs.google.com/document/d/${input.fileId}`,
    },
  }),
};

// ─── Default fallback for unknown tools ─────────────────────────────────────

function defaultMockResponse(toolName: string, input: Record<string, unknown>): ToolResult {
  return {
    output: {
      message: `Mock response for ${toolName}`,
      input,
      _mock: true,
    },
  };
}

// ─── Connector ──────────────────────────────────────────────────────────────

/**
 * DevMockConnector wraps a real connector, using its tool definitions
 * but returning mock data instead of hitting real APIs.
 */
export class DevMockConnector implements MCPConnector {
  readonly provider: string;
  private inner: MCPConnector;

  constructor(realConnector: MCPConnector) {
    this.inner = realConnector;
    this.provider = realConnector.provider;
  }

  async connect(_config: ConnectorConfig): Promise<void> {
    // No-op — we don't need real credentials
  }

  async disconnect(): Promise<void> {
    // No-op
  }

  listTools(): ToolDefinition[] {
    // Reuse the real connector's tool definitions
    return this.inner.listTools();
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const mockFn = MOCK_RESPONSES[toolName];
    if (mockFn) {
      return mockFn(input);
    }
    return defaultMockResponse(toolName, input);
  }

  async healthCheck(): Promise<boolean> {
    return true; // Always healthy in dev
  }
}
