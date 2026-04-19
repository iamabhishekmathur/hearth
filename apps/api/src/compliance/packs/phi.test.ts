import { describe, it, expect } from 'vitest';
import { phiDetectors } from './phi.js';
import { detectEntities } from '../scrubber.js';

describe('PHI Pack Detectors', () => {
  describe('MRN', () => {
    it('detects MRN with prefix', () => {
      const entities = detectEntities('MRN: A12345678', phiDetectors);
      expect(entities.some((e) => e.entityType === 'MRN')).toBe(true);
    });

    it('detects patient ID', () => {
      const entities = detectEntities('patient id: PT99001', phiDetectors);
      expect(entities.some((e) => e.entityType === 'MRN')).toBe(true);
    });
  });

  describe('Health Plan ID', () => {
    it('detects insurance ID', () => {
      const entities = detectEntities('insurance id: BCBS12345678', phiDetectors);
      expect(entities.some((e) => e.entityType === 'HEALTH_PLAN_ID')).toBe(true);
    });

    it('detects member number', () => {
      const entities = detectEntities('member number: XYZ98765', phiDetectors);
      expect(entities.some((e) => e.entityType === 'HEALTH_PLAN_ID')).toBe(true);
    });
  });

  describe('Medication', () => {
    it('detects medication with context', () => {
      const entities = detectEntities('prescribed Metformin 500mg', phiDetectors);
      expect(entities.some((e) => e.entityType === 'MEDICATION')).toBe(true);
    });

    it('detects medication reference', () => {
      const entities = detectEntities('medication: Lisinopril 10mg', phiDetectors);
      expect(entities.some((e) => e.entityType === 'MEDICATION')).toBe(true);
    });
  });
});
