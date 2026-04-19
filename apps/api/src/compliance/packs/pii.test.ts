import { describe, it, expect } from 'vitest';
import { piiDetectors } from './pii.js';
import { detectEntities } from '../scrubber.js';

describe('PII Pack Detectors', () => {
  describe('SSN', () => {
    it('detects valid SSN', () => {
      const entities = detectEntities('My SSN is 123-45-6789.', piiDetectors);
      expect(entities.some((e) => e.entityType === 'SSN')).toBe(true);
    });

    it('rejects area 000', () => {
      const entities = detectEntities('SSN: 000-12-3456', piiDetectors);
      expect(entities.some((e) => e.entityType === 'SSN')).toBe(false);
    });

    it('rejects area 666', () => {
      const entities = detectEntities('SSN: 666-12-3456', piiDetectors);
      expect(entities.some((e) => e.entityType === 'SSN')).toBe(false);
    });

    it('rejects area 900+', () => {
      const entities = detectEntities('SSN: 900-12-3456', piiDetectors);
      expect(entities.some((e) => e.entityType === 'SSN')).toBe(false);
    });
  });

  describe('Email', () => {
    it('detects standard email', () => {
      const entities = detectEntities('Email: john.doe@example.com', piiDetectors);
      expect(entities.some((e) => e.entityType === 'EMAIL')).toBe(true);
    });

    it('detects email with plus addressing', () => {
      const entities = detectEntities('user+tag@domain.co.uk', piiDetectors);
      expect(entities.some((e) => e.entityType === 'EMAIL')).toBe(true);
    });

    it('does not detect partial email', () => {
      const entities = detectEntities('not an email @user', piiDetectors);
      expect(entities.some((e) => e.entityType === 'EMAIL')).toBe(false);
    });
  });

  describe('Phone', () => {
    it('detects US phone with parentheses', () => {
      const entities = detectEntities('Call (555) 123-4567', piiDetectors);
      expect(entities.some((e) => e.entityType === 'PHONE')).toBe(true);
    });

    it('detects US phone with dashes', () => {
      const entities = detectEntities('Phone: 555-123-4567', piiDetectors);
      expect(entities.some((e) => e.entityType === 'PHONE')).toBe(true);
    });

    it('detects US phone with +1 prefix', () => {
      const entities = detectEntities('Phone: +1-555-123-4567', piiDetectors);
      expect(entities.some((e) => e.entityType === 'PHONE')).toBe(true);
    });
  });

  describe('Person Name', () => {
    it('detects name with title', () => {
      const entities = detectEntities('Please contact Mr. John Smith.', piiDetectors);
      expect(entities.some((e) => e.entityType === 'PERSON_NAME')).toBe(true);
    });

    it('detects name with Dr. prefix', () => {
      const entities = detectEntities('Dr. Jane Doe prescribed medication.', piiDetectors);
      expect(entities.some((e) => e.entityType === 'PERSON_NAME')).toBe(true);
    });

    it('detects name with context keyword', () => {
      const entities = detectEntities('The patient John Smith arrived.', piiDetectors);
      expect(entities.some((e) => e.entityType === 'PERSON_NAME')).toBe(true);
    });
  });

  describe('Address', () => {
    it('detects street address', () => {
      const entities = detectEntities('Lives at 123 Oak Avenue in town.', piiDetectors);
      expect(entities.some((e) => e.entityType === 'ADDRESS')).toBe(true);
    });

    it('detects address with abbreviated street type', () => {
      const entities = detectEntities('Office at 456 Elm St today.', piiDetectors);
      expect(entities.some((e) => e.entityType === 'ADDRESS')).toBe(true);
    });
  });

  describe('DOB', () => {
    it('detects DOB with context', () => {
      const entities = detectEntities('DOB: 01/15/1990', piiDetectors);
      expect(entities.some((e) => e.entityType === 'DOB')).toBe(true);
    });

    it('detects date of birth written out', () => {
      const entities = detectEntities('date of birth: Jan 15, 1990', piiDetectors);
      expect(entities.some((e) => e.entityType === 'DOB')).toBe(true);
    });
  });
});
