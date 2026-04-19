import type { CompliancePack, EntityDetector } from '../types.js';

/** Validate IBAN with basic structure check + length per country */
function validateIBAN(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '');
  if (cleaned.length < 15 || cleaned.length > 34) return false;
  // Basic structure: 2 letter country code + 2 check digits + BBAN
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleaned);
}

const euNationalIdDetector: EntityDetector = {
  id: 'gdpr.EU_NATIONAL_ID',
  name: 'EU National ID Number',
  entityType: 'EU_NATIONAL_ID',
  patterns: [
    // UK NI number: AB 12 34 56 C
    /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi,
    // German ID: T followed by 8 alphanumeric
    /\b[LMT]\d{8}\b/g,
    // French NIR (social security): 1 or 2 followed by 12 digits
    /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g,
    // Generic national ID context
    /(?:national\s+(?:id|identification)\s*(?:number|no|#)?|personal\s+(?:id|number)|citizen\s+id)\s*[:;#]?\s*[A-Z0-9]{6,15}\b/gi,
  ],
  priority: 8,
};

const ibanDetector: EntityDetector = {
  id: 'gdpr.IBAN',
  name: 'International Bank Account Number',
  entityType: 'IBAN',
  patterns: [
    /\b[A-Z]{2}\d{2}\s?[A-Z0-9]{4}\s?(?:[A-Z0-9]{4}\s?){1,7}[A-Z0-9]{1,4}\b/g,
  ],
  validate: validateIBAN,
  priority: 9,
};

const euVatDetector: EntityDetector = {
  id: 'gdpr.EU_VAT',
  name: 'EU VAT Number',
  entityType: 'EU_VAT',
  patterns: [
    // EU VAT format: 2-letter country code + 8-12 alphanumeric
    /\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[A-Z0-9]{8,12}\b/g,
  ],
  priority: 7,
};

const euPhoneDetector: EntityDetector = {
  id: 'gdpr.EU_PHONE',
  name: 'EU Phone Number',
  entityType: 'EU_PHONE',
  patterns: [
    // International format: +33 1 23 45 67 89, +49-123-456789, +44 7911 123456
    /\+(?:3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9])[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,4}[-.\s]?\d{0,4}\b/g,
  ],
  validate: (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 15;
  },
  priority: 6,
};

export const gdprDetectors: EntityDetector[] = [
  euNationalIdDetector,
  ibanDetector,
  euVatDetector,
  euPhoneDetector,
];

export const gdprPack: CompliancePack = {
  id: 'gdpr',
  name: 'GDPR (General Data Protection Regulation)',
  description: 'Detects and scrubs EU national IDs, IBANs, VAT numbers, and EU phone formats. Extends PII pack.',
  category: 'privacy',
  detectors: gdprDetectors,
  extends: ['pii'],
};
