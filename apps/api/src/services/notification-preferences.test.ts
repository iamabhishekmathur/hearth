import { describe, it, expect } from 'vitest';
import {
  defaultPreferences,
  preferencesPatchSchema,
  resolvePreferences,
} from './notification-preferences.js';

describe('defaultPreferences', () => {
  it('summary on, email off, impact on; weekly summary on only for admins', () => {
    expect(defaultPreferences('member')).toEqual({
      knowledgeSummary: true,
      knowledgeEmail: false,
      adminWeeklySummary: false,
      knowledgeImpact: true,
    });
    expect(defaultPreferences('admin').adminWeeklySummary).toBe(true);
    expect(defaultPreferences('team_lead').adminWeeklySummary).toBe(false);
  });
});

describe('resolvePreferences', () => {
  it('fills missing keys from the defaults', () => {
    expect(resolvePreferences({ knowledgeEmail: true }, 'admin')).toEqual({
      knowledgeSummary: true,
      knowledgeEmail: true,
      adminWeeklySummary: true,
      knowledgeImpact: true,
    });
  });
  it('ignores junk: non-objects, arrays, non-boolean values, unknown keys', () => {
    const d = defaultPreferences('member');
    expect(resolvePreferences(null, 'member')).toEqual(d);
    expect(resolvePreferences('x', 'member')).toEqual(d);
    expect(resolvePreferences([true], 'member')).toEqual(d);
    expect(resolvePreferences({ knowledgeSummary: 'no', other: false }, 'member')).toEqual(d);
  });
  it('an explicit false wins over a default true', () => {
    expect(resolvePreferences({ knowledgeSummary: false }, 'member').knowledgeSummary).toBe(false);
  });
});

describe('preferencesPatchSchema', () => {
  it('accepts any subset of booleans', () => {
    expect(preferencesPatchSchema.safeParse({}).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ knowledgeEmail: true }).success).toBe(true);
  });
  it('rejects unknown keys, non-booleans and non-objects', () => {
    expect(preferencesPatchSchema.safeParse({ spam: true }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ knowledgeEmail: 'yes' }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse([]).success).toBe(false);
    expect(preferencesPatchSchema.safeParse('on').success).toBe(false);
  });
});
