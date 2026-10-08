import { describe, it, expect } from 'vitest';
import type { PermissionRule } from '@hearth/shared';
import { evaluateToolCall, DEFAULT_PERMISSION_RULES } from './permission-policy.js';

// W3 §5.1 cases 19, 20, 23, 24, 25 (the pure-evaluation subset). The parked
// ask/resume + persistence paths are covered by permission-loop.test.ts.

describe('evaluateToolCall — rule matching', () => {
  it('case 19: an explicit allow rule lets the tool run', () => {
    const rules: PermissionRule[] = [{ toolPattern: 'recall_decisions', level: 'allow' }];
    const r = evaluateToolCall({ toolName: 'recall_decisions', input: {}, orgRules: rules });
    expect(r.level).toBe('allow');
  });

  it('case 20: a deny rule resolves to deny (loop maps this to blocked_by_policy)', () => {
    const rules: PermissionRule[] = [{ toolPattern: 'jira_*', level: 'deny' }];
    const r = evaluateToolCall({ toolName: 'jira_delete_issue', input: {}, orgRules: rules });
    expect(r.level).toBe('deny');
  });

  it('case 23: glob + arg pattern match (slack channel glob)', () => {
    const rules: PermissionRule[] = [
      { toolPattern: 'slack_post_message', argPattern: { channel: '#sales*' }, level: 'ask' },
    ];
    // Matches the arg pattern → ask.
    const match = evaluateToolCall({
      toolName: 'slack_post_message',
      input: { channel: '#sales-eng', text: 'hi' },
      orgRules: rules,
    });
    expect(match.level).toBe('ask');

    // Arg pattern does NOT match → this rule is skipped; falls through to the
    // built-in default for slack_post_message (ask) regardless, so assert the
    // specific rule was NOT the one that matched by using a non-default tool.
    const noMatch = evaluateToolCall({
      toolName: 'slack_post_message',
      input: { channel: '#random', text: 'hi' },
      orgRules: [{ toolPattern: 'slack_post_message', argPattern: { channel: '#sales*' }, level: 'deny' }],
    });
    // The deny rule didn't apply (channel mismatch); default ask wins.
    expect(noMatch.level).toBe('ask');
  });

  it('case 24: user narrowing cannot widen a non-overridable org deny', () => {
    const orgRules: PermissionRule[] = [
      { toolPattern: 'integration_*', level: 'deny', userScopeOverridable: false },
    ];
    const userRules: PermissionRule[] = [{ toolPattern: 'integration_sync', level: 'allow' }];
    const r = evaluateToolCall({
      toolName: 'integration_sync',
      input: {},
      orgRules,
      userRules,
    });
    expect(r.level).toBe('deny');
    expect(r.nonOverridable).toBe(true);
  });

  it('case 24b: user CAN narrow an overridable org allow toward deny', () => {
    const orgRules: PermissionRule[] = [{ toolPattern: 'web_search', level: 'allow' }];
    const userRules: PermissionRule[] = [{ toolPattern: 'web_search', level: 'deny' }];
    const r = evaluateToolCall({ toolName: 'web_search', input: {}, orgRules, userRules });
    expect(r.level).toBe('deny');
    expect(r.nonOverridable).toBe(false);
  });

  it('case 24c: user may NOT widen (allow) an overridable org deny — narrowing only', () => {
    const orgRules: PermissionRule[] = [{ toolPattern: 'send_email', level: 'deny' }];
    const userRules: PermissionRule[] = [{ toolPattern: 'send_email', level: 'allow' }];
    const r = evaluateToolCall({ toolName: 'send_email', input: {}, orgRules, userRules });
    // allow is weaker than deny → the user rule is ignored (can't widen).
    expect(r.level).toBe('deny');
  });

  it('case 25: default policy — recall=allow, slack_post_message=ask, integration_delete=deny', () => {
    expect(evaluateToolCall({ toolName: 'recall_decisions', input: {} }).level).toBe('allow');
    expect(evaluateToolCall({ toolName: 'slack_post_message', input: { channel: '#x' } }).level).toBe('ask');
    const del = evaluateToolCall({ toolName: 'integration_delete', input: {} });
    expect(del.level).toBe('deny');
    expect(del.nonOverridable).toBe(true);
  });

  it('agent-profile rules refine the org base (Plan/Build substrate)', () => {
    // Org allows web_search; the plan profile denies it (read-only plan).
    const agentRules: PermissionRule[] = [{ toolPattern: '*', level: 'deny' }];
    const r = evaluateToolCall({
      toolName: 'create_task',
      input: { title: 'x' },
      agentRules,
    });
    expect(r.level).toBe('deny');
  });

  it('defaults: safe fallthrough is allow for an unknown Hearth-native tool', () => {
    const r = evaluateToolCall({ toolName: 'some_novel_tool', input: {} });
    expect(r.level).toBe('allow');
  });

  it('defaults list ends with a catch-all allow', () => {
    expect(DEFAULT_PERMISSION_RULES[DEFAULT_PERMISSION_RULES.length - 1]).toEqual({
      toolPattern: '*',
      level: 'allow',
    });
  });

  it('nested arg pattern subset match', () => {
    const rules: PermissionRule[] = [
      { toolPattern: 'deploy_service', argPattern: { target: { env: 'prod' } }, level: 'deny' },
    ];
    expect(
      evaluateToolCall({ toolName: 'deploy_service', input: { target: { env: 'prod', region: 'us' } }, orgRules: rules }).level,
    ).toBe('deny');
    // Non-prod → rule doesn't match → default allow.
    expect(
      evaluateToolCall({ toolName: 'deploy_service', input: { target: { env: 'staging' } }, orgRules: rules }).level,
    ).toBe('allow');
  });
});
