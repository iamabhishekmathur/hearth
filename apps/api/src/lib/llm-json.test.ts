import { describe, it, expect } from 'vitest';
import { extractJsonObject } from './llm-json.js';

describe('extractJsonObject', () => {
  it('returns a bare object as-is', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('unwraps a ```json fence', () => {
    expect(JSON.parse(extractJsonObject('```json\n{"a":1}\n```')!)).toEqual({ a: 1 });
  });

  it('unwraps a bare ``` fence', () => {
    expect(JSON.parse(extractJsonObject('```\n{"a":2}\n```')!)).toEqual({ a: 2 });
  });

  it('strips prose before and after the object', () => {
    const raw = 'Sure! Here it is:\n{"isDecision": true}\nHope that helps.';
    expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ isDecision: true });
  });

  it('keeps nested objects whole', () => {
    expect(JSON.parse(extractJsonObject('x {"a":{"b":[1,2]}} y')!)).toEqual({ a: { b: [1, 2] } });
  });

  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});
