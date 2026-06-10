import { describe, it, expect } from 'vitest';
import type { DeliveryRule, DeliveryTarget } from '@hearth/shared';
import { evaluateDeliveryRules, applyTemplate } from './delivery-rule-engine.js';

// Pure-logic tests — no Prisma, no mocks.

function target(channel: DeliveryTarget['channel'] = 'in_app'): DeliveryTarget {
  return { channel, config: {} };
}

function rule(
  type: DeliveryRule['condition']['type'],
  value: string | undefined,
  targets: DeliveryTarget[],
): DeliveryRule {
  return { condition: { type, value }, targets };
}

// ── evaluateDeliveryRules ──

describe('evaluateDeliveryRules — condition matching', () => {
  it('"always" matches regardless of output', () => {
    const result = evaluateDeliveryRules([rule('always', undefined, [target('slack')])], 'anything');
    expect(result).toHaveLength(1);
    expect(result[0].channel).toBe('slack');
  });

  it('"contains" matches when the value is a case-insensitive substring', () => {
    const result = evaluateDeliveryRules(
      [rule('contains', 'Urgent', [target()])],
      'this report is URGENT today',
    );
    expect(result).toHaveLength(1);
  });

  it('"contains" does not match when the substring is absent', () => {
    const result = evaluateDeliveryRules([rule('contains', 'urgent', [target()])], 'all calm');
    expect(result).toHaveLength(0);
  });

  it('"contains" with no value never matches', () => {
    const result = evaluateDeliveryRules([rule('contains', undefined, [target()])], 'anything');
    expect(result).toHaveLength(0);
  });

  it('"not_contains" matches when the substring is absent', () => {
    const result = evaluateDeliveryRules([rule('not_contains', 'error', [target()])], 'all good');
    expect(result).toHaveLength(1);
  });

  it('"not_contains" does not match when the substring is present', () => {
    const result = evaluateDeliveryRules(
      [rule('not_contains', 'error', [target()])],
      'there was an ERROR',
    );
    expect(result).toHaveLength(0);
  });

  it('"not_contains" with no value matches (nothing to exclude)', () => {
    const result = evaluateDeliveryRules([rule('not_contains', undefined, [target()])], 'anything');
    expect(result).toHaveLength(1);
  });

  it('"agent_tag" matches when the tag is present', () => {
    const result = evaluateDeliveryRules(
      [rule('agent_tag', 'priority', [target()])],
      'output',
      ['priority', 'misc'],
    );
    expect(result).toHaveLength(1);
  });

  it('"agent_tag" does not match when the tag is absent', () => {
    const result = evaluateDeliveryRules(
      [rule('agent_tag', 'priority', [target()])],
      'output',
      ['misc'],
    );
    expect(result).toHaveLength(0);
  });

  it('"agent_tag" with no value never matches', () => {
    const result = evaluateDeliveryRules(
      [rule('agent_tag', undefined, [target()])],
      'output',
      ['priority'],
    );
    expect(result).toHaveLength(0);
  });

  it('defaults tags to an empty array when omitted', () => {
    const result = evaluateDeliveryRules([rule('agent_tag', 'priority', [target()])], 'output');
    expect(result).toHaveLength(0);
  });
});

describe('evaluateDeliveryRules — aggregation across rules', () => {
  it('accumulates targets from every matching rule', () => {
    const result = evaluateDeliveryRules(
      [
        rule('always', undefined, [target('slack')]),
        rule('contains', 'urgent', [target('email')]),
      ],
      'urgent matter',
    );
    expect(result.map((t) => t.channel)).toEqual(['slack', 'email']);
  });

  it('flattens multiple targets within a single rule', () => {
    const result = evaluateDeliveryRules(
      [rule('always', undefined, [target('slack'), target('notion')])],
      'output',
    );
    expect(result).toHaveLength(2);
  });

  it('returns an empty array when no rules match', () => {
    const result = evaluateDeliveryRules(
      [rule('contains', 'nope', [target()])],
      'irrelevant output',
    );
    expect(result).toEqual([]);
  });

  it('returns an empty array for an empty rule set', () => {
    expect(evaluateDeliveryRules([], 'output')).toEqual([]);
  });
});

// ── applyTemplate ──

describe('applyTemplate', () => {
  it('returns raw output when no template is supplied', () => {
    expect(applyTemplate(undefined, 'hello')).toBe('hello');
  });

  it('substitutes a single {{output}} placeholder', () => {
    expect(applyTemplate('Result: {{output}}', 'done')).toBe('Result: done');
  });

  it('substitutes every occurrence of {{output}}', () => {
    expect(applyTemplate('{{output}} / {{output}}', 'x')).toBe('x / x');
  });

  it('returns the template unchanged when it has no placeholder', () => {
    expect(applyTemplate('static text', 'ignored')).toBe('static text');
  });
});
