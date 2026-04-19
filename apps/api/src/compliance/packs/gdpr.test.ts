import { describe, it, expect } from 'vitest';
import { gdprDetectors } from './gdpr.js';
import { detectEntities } from '../scrubber.js';

describe('GDPR Pack Detectors', () => {
  describe('IBAN', () => {
    it('detects valid IBAN', () => {
      const entities = detectEntities('IBAN: DE89370400440532013000', gdprDetectors);
      expect(entities.some((e) => e.entityType === 'IBAN')).toBe(true);
    });

    it('detects IBAN with spaces', () => {
      const entities = detectEntities('Account: GB29 NWBK 6016 1331 9268 19', gdprDetectors);
      expect(entities.some((e) => e.entityType === 'IBAN')).toBe(true);
    });
  });

  describe('EU VAT', () => {
    it('detects German VAT number', () => {
      const entities = detectEntities('VAT: DE123456789', gdprDetectors);
      expect(entities.some((e) => e.entityType === 'EU_VAT')).toBe(true);
    });

    it('detects French VAT number', () => {
      const entities = detectEntities('FR12345678901', gdprDetectors);
      expect(entities.some((e) => e.entityType === 'EU_VAT')).toBe(true);
    });
  });

  describe('EU Phone', () => {
    it('detects EU phone number with country code', () => {
      const entities = detectEntities('Phone: +49-123-456-7890', gdprDetectors);
      expect(entities.some((e) => e.entityType === 'EU_PHONE')).toBe(true);
    });

    it('detects UK phone number', () => {
      const entities = detectEntities('+44 7911 123456', gdprDetectors);
      expect(entities.some((e) => e.entityType === 'EU_PHONE')).toBe(true);
    });
  });
});
