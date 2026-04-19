import { describe, it, expect } from 'vitest';
import { pciDetectors } from './pci-dss.js';
import { detectEntities } from '../scrubber.js';

describe('PCI-DSS Pack Detectors', () => {
  describe('Credit Card', () => {
    it('detects Visa card number', () => {
      // 4111-1111-1111-1111 passes Luhn
      const entities = detectEntities('Card: 4111-1111-1111-1111', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CREDIT_CARD')).toBe(true);
    });

    it('detects card number without separators', () => {
      const entities = detectEntities('Card: 4111111111111111', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CREDIT_CARD')).toBe(true);
    });

    it('rejects number failing Luhn check', () => {
      const entities = detectEntities('Card: 4111-1111-1111-1112', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CREDIT_CARD')).toBe(false);
    });

    it('detects Mastercard', () => {
      // 5500-0000-0000-0004 passes Luhn
      const entities = detectEntities('Card: 5500-0000-0000-0004', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CREDIT_CARD')).toBe(true);
    });
  });

  describe('CVV', () => {
    it('detects CVV with context', () => {
      const entities = detectEntities('CVV: 123', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CVV')).toBe(true);
    });

    it('detects security code with context', () => {
      const entities = detectEntities('security code 4567', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CVV')).toBe(true);
    });

    it('does not detect random 3-digit number without context', () => {
      const entities = detectEntities('I have 123 apples', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CVV')).toBe(false);
    });
  });

  describe('Card Expiry', () => {
    it('detects expiry with context', () => {
      const entities = detectEntities('exp 01/25', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CARD_EXPIRY')).toBe(true);
    });

    it('detects expires with full year', () => {
      const entities = detectEntities('expires 12/2025', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CARD_EXPIRY')).toBe(true);
    });

    it('detects valid thru', () => {
      const entities = detectEntities('valid thru 06/28', pciDetectors);
      expect(entities.some((e) => e.entityType === 'CARD_EXPIRY')).toBe(true);
    });
  });
});
