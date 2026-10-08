import { describe, it, expect } from 'vitest';
import { evaluateToolCall } from './permission-policy.js';
import {
  PLAN_PROFILE,
  BUILD_PROFILE,
  PLAN_PROFILE_ID,
  BUILD_PROFILE_ID,
  profileIdForMode,
  getBuiltinProfile,
} from './agent-profiles.js';

// W4 §5.1 case 27 + J3 "write-in-plan denied" — the plan profile's agent-layer
// rules make every write/side-effect tool a hard deny while allowing reads.
// We feed the plan profile's rules directly into evaluateToolCall (the exact
// path loadPolicyRules + the loop use) so this asserts the real enforcement.

const planAgentRules = PLAN_PROFILE.rules;

function evalInPlan(toolName: string, input: Record<string, unknown> = {}) {
  return evaluateToolCall({ toolName, input, agentRules: planAgentRules });
}

describe('plan profile — read-only enforcement (W4)', () => {
  it('case 27: a write tool (create_task) is DENIED in plan mode', () => {
    expect(evalInPlan('create_task', { title: 'x' }).level).toBe('deny');
  });

  it('denies external side-effect tools (slack_post_message, send_email)', () => {
    expect(evalInPlan('slack_post_message', { channel: '#x', text: 'hi' }).level).toBe('deny');
    expect(evalInPlan('send_email').level).toBe('deny');
  });

  it('denies MCP write tools and code execution and sub-agents', () => {
    expect(evalInPlan('mcp__slack__post_message').level).toBe('deny');
    expect(evalInPlan('code_execution', { language: 'node', code: '1' }).level).toBe('deny');
    expect(evalInPlan('delegate_task', { task: 'x' }).level).toBe('deny');
    expect(evalInPlan('update_artifact', { artifact_id: 'a', content: 'c' }).level).toBe('deny');
  });

  it('ALLOWS read/recall/search tools so the agent can research', () => {
    expect(evalInPlan('recall_memory', { query: 'q' }).level).toBe('allow');
    expect(evalInPlan('recall_decisions', { query: 'q' }).level).toBe('allow');
    expect(evalInPlan('search_decisions').level).toBe('allow');
    expect(evalInPlan('session_search', { query: 'q' }).level).toBe('allow');
    expect(evalInPlan('list_tasks').level).toBe('allow');
    expect(evalInPlan('get_task_context', { item_id: 'i' }).level).toBe('allow');
    expect(evalInPlan('web_search', { query: 'q' }).level).toBe('allow');
    expect(evalInPlan('web_fetch', { url: 'http://x' }).level).toBe('allow');
  });

  it('ALLOWS submit_plan (the planning-output tool)', () => {
    expect(evalInPlan('submit_plan', { steps: [] }).level).toBe('allow');
  });

  it('fails closed: an unknown/unrecognized tool is denied in plan mode', () => {
    expect(evalInPlan('some_new_write_tool').level).toBe('deny');
  });

  it('the plan deny is non-overridable — a user allow rule cannot widen it', () => {
    const r = evaluateToolCall({
      toolName: 'create_task',
      input: {},
      agentRules: planAgentRules,
      userRules: [{ toolPattern: 'create_task', level: 'allow' }],
    });
    expect(r.level).toBe('deny');
  });
});

describe('build profile — full tools (W4)', () => {
  const buildAgentRules = BUILD_PROFILE.rules;

  it('adds no agent-layer restrictions — org/default policy governs', () => {
    expect(buildAgentRules).toHaveLength(0);
    // With no agent rules, an external side-effect falls through to the built-in
    // default (ask), and a read to allow — i.e. today's W3 behavior. (Note the
    // default policy allows most Hearth-native writes like create_task.)
    expect(evaluateToolCall({ toolName: 'slack_post_message', input: {}, agentRules: buildAgentRules }).level).toBe('ask');
    expect(evaluateToolCall({ toolName: 'recall_memory', input: {}, agentRules: buildAgentRules }).level).toBe('allow');
  });
});

describe('profile resolution', () => {
  it('profileIdForMode maps modes to built-in ids; undefined → build', () => {
    expect(profileIdForMode('plan')).toBe(PLAN_PROFILE_ID);
    expect(profileIdForMode('build')).toBe(BUILD_PROFILE_ID);
    expect(profileIdForMode(undefined)).toBe(BUILD_PROFILE_ID);
  });

  it('getBuiltinProfile returns the matching profile or undefined', () => {
    expect(getBuiltinProfile(PLAN_PROFILE_ID)).toBe(PLAN_PROFILE);
    expect(getBuiltinProfile(BUILD_PROFILE_ID)).toBe(BUILD_PROFILE);
    expect(getBuiltinProfile('org:custom')).toBeUndefined();
    expect(getBuiltinProfile(null)).toBeUndefined();
  });
});
