import { describe, it, expect } from 'vitest';
import { getUserCadence, shouldSendPrepNow } from './meeting-prep-service.js';

describe('meeting-prep-service', () => {
  describe('getUserCadence', () => {
    it('returns configured cadence', () => {
      expect(getUserCadence({ meetingPrepCadence: '24h_before' })).toBe('24h_before');
    });

    it('returns default for missing preference', () => {
      expect(getUserCadence({})).toBe('1h_before');
    });

    it('returns default for invalid value', () => {
      expect(getUserCadence({ meetingPrepCadence: 'invalid' })).toBe('1h_before');
    });
  });

  describe('shouldSendPrepNow', () => {
    it('returns false when cadence is off', () => {
      const meetingStart = new Date(Date.now() + 60 * 60 * 1000);
      expect(shouldSendPrepNow(meetingStart, 'off')).toBe(false);
    });

    it('returns true for 1h_before when meeting is ~1 hour away', () => {
      const meetingStart = new Date(Date.now() + 60 * 60 * 1000);
      expect(shouldSendPrepNow(meetingStart, '1h_before')).toBe(true);
    });

    it('returns false for 1h_before when meeting is 3 hours away', () => {
      const meetingStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
      expect(shouldSendPrepNow(meetingStart, '1h_before')).toBe(false);
    });

    it('returns true for 24h_before when meeting is ~24 hours away', () => {
      const meetingStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect(shouldSendPrepNow(meetingStart, '24h_before')).toBe(true);
    });

    it('returns false for past meetings', () => {
      const meetingStart = new Date(Date.now() - 60 * 60 * 1000);
      expect(shouldSendPrepNow(meetingStart, '1h_before')).toBe(false);
    });
  });
});
