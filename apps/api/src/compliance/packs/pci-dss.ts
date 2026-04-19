import type { CompliancePack, EntityDetector } from '../types.js';

/** Luhn algorithm for credit card validation */
function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

const creditCardDetector: EntityDetector = {
  id: 'pci.CREDIT_CARD',
  name: 'Credit Card Number',
  entityType: 'CREDIT_CARD',
  patterns: [
    // Visa, Mastercard, Amex, Discover with optional spaces/dashes
    /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    // Amex format: 3xxx-xxxxxx-xxxxx
    /\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g,
  ],
  validate: (match) => luhnCheck(match),
  priority: 10,
};

const cvvDetector: EntityDetector = {
  id: 'pci.CVV',
  name: 'Card Verification Value',
  entityType: 'CVV',
  patterns: [
    // Context-dependent: "CVV: 123", "CVV is 123", "security code 1234"
    /(?:CVV|CVC|CVV2|CVC2|security\s+code)\s*(?:[:;]|is)?\s*\d{3,4}\b/gi,
  ],
  priority: 8,
};

const expiryDetector: EntityDetector = {
  id: 'pci.CARD_EXPIRY',
  name: 'Card Expiration Date',
  entityType: 'CARD_EXPIRY',
  patterns: [
    // Context-dependent: "exp 01/25", "expires 12/2025", "expiry: 01/26"
    /(?:exp(?:ir(?:y|es|ation))?|valid\s+(?:thru|through|until))\s*[:;]?\s*(?:0[1-9]|1[0-2])\s*[/-]\s*(?:\d{2}|\d{4})\b/gi,
  ],
  priority: 7,
};

export const pciDetectors: EntityDetector[] = [
  creditCardDetector,
  cvvDetector,
  expiryDetector,
];

export const pciPack: CompliancePack = {
  id: 'pci-dss',
  name: 'PCI-DSS (Payment Card Industry)',
  description: 'Detects and scrubs credit card numbers (Luhn-validated), CVVs, and card expiration dates.',
  category: 'financial',
  detectors: pciDetectors,
};
