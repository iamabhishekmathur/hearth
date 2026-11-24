import { describe, it, expect } from 'vitest';
import { isReadOnlyTool, splitReadOnlyTools } from './routine-dry-run.js';
import type { AgentTool } from '../agent/types.js';

describe('isReadOnlyTool (dry-run tool blocking, F6)', () => {
  it.each([
    'recall_memory',
    'web_search',
    'web_fetch',
    'read_file',
    'list_tasks',
    'get_task_context',
    'list_routines',
    'session_search',
    'list_artifacts',
    'recall_decisions',
    'get_decision_context',
    'slack_list_channels',
    'slack_search_messages',
    'jira_get_issue',
    'jira_search',
    'gdrive_read_file',
    'gcalendar_list_events',
    'github_search_code',
    'mcp__github__list_prs',
  ])('%s is allowed', (name) => {
    expect(isReadOnlyTool(name)).toBe(true);
  });

  it.each([
    'slack_post_message',
    'gmail_send_email',
    'jira_create_issue',
    'github_create_issue',
    'notion_create_page',
    'create_routine',
    'update_routine',
    'save_memory',
    'session_note',
    'create_task',
    'propose_task',
    'update_task',
    'create_artifact',
    'update_artifact',
    'write_file',
    'code_execution',
    'delegate_task',
    'schedule_action',
    'capture_decision',
    'update_decision_outcome',
    'routine_state',
    'set_delivery_tag',
    'submit_plan',
    'clarify',
    'vision_analyze',
    'mcp__slack__post_message',
    'mcp__jira__search_and_update',
    'something_unknown',
  ])('%s is held back', (name) => {
    expect(isReadOnlyTool(name)).toBe(false);
  });
});

describe('splitReadOnlyTools', () => {
  it('keeps read tools and names the rest', () => {
    const tool = (name: string): AgentTool => ({
      name,
      description: '',
      inputSchema: {},
      handler: async () => ({ output: {} }),
    });
    const { allowed, blocked } = splitReadOnlyTools([
      tool('recall_memory'),
      tool('slack_post_message'),
      tool('save_memory'),
    ]);
    expect(allowed.map((t) => t.name)).toEqual(['recall_memory']);
    expect(blocked).toEqual(['slack_post_message', 'save_memory']);
  });
});
