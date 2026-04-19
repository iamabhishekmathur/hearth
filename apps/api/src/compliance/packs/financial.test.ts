import { describe, it, expect } from 'vitest';
import { financialDetectors } from './financial.js';
import { detectEntities } from '../scrubber.js';

describe('Financial/SOX Pack Detectors', () => {
  describe('Account Number', () => {
    it('detects bank account number', () => {
      const entities = detectEntities('account number: 12345678901', financialDetectors);
      expect(entities.some((e) => e.entityType === 'ACCOUNT_NUMBER')).toBe(true);
    });

    it('detects acct with short label', () => {
      const entities = detectEntities('acct# 9876543210', financialDetectors);
      expect(entities.some((e) => e.entityType === 'ACCOUNT_NUMBER')).toBe(true);
    });
  });

  describe('Routing Number', () => {
    it('detects valid ABA routing number', () => {
      // 021000021 (JPMorgan Chase) passes ABA checksum
      const entities = detectEntities('routing number: 021000021', financialDetectors);
      expect(entities.some((e) => e.entityType === 'ROUTING_NUMBER')).toBe(true);
    });

    it('rejects invalid ABA routing number', () => {
      const entities = detectEntities('routing number: 123456789', financialDetectors);
      expect(entities.some((e) => e.entityType === 'ROUTING_NUMBER')).toBe(false);
    });
  });

  describe('Financial Amount', () => {
    it('detects salary with context', () => {
      const entities = detectEntities('salary $120,000', financialDetectors);
      expect(entities.some((e) => e.entityType === 'FINANCIAL_AMOUNT')).toBe(true);
    });

    it('detects revenue amount', () => {
      const entities = detectEntities('revenue of $1,234,567.89', financialDetectors);
      expect(entities.some((e) => e.entityType === 'FINANCIAL_AMOUNT')).toBe(true);
    });
  });

  describe('SWIFT Code', () => {
    it('detects SWIFT code', () => {
      const entities = detectEntities('SWIFT: DEUTDEFF', financialDetectors);
      expect(entities.some((e) => e.entityType === 'SWIFT_CODE')).toBe(true);
    });

    it('detects BIC code with branch', () => {
      const entities = detectEntities('BIC: CHASUS33XXX', financialDetectors);
      expect(entities.some((e) => e.entityType === 'SWIFT_CODE')).toBe(true);
    });
  });
});
