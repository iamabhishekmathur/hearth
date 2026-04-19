import type { CompliancePack, EntityDetector } from '../types.js';

/** Validate ABA routing number with checksum */
function validateABARouting(routing: string): boolean {
  const digits = routing.replace(/\D/g, '');
  if (digits.length !== 9) return false;

  const d = digits.split('').map(Number);
  // ABA checksum: 3(d1 + d4 + d7) + 7(d2 + d5 + d8) + (d3 + d6 + d9) mod 10 === 0
  const checksum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    (d[2] + d[5] + d[8]);
  return checksum % 10 === 0;
}

const accountNumberDetector: EntityDetector = {
  id: 'financial.ACCOUNT_NUMBER',
  name: 'Bank Account Number',
  entityType: 'ACCOUNT_NUMBER',
  patterns: [
    /(?:account\s*(?:number|no|#)?|acct)\s*[:;#]?\s*\d{8,17}\b/gi,
  ],
  priority: 9,
};

const routingNumberDetector: EntityDetector = {
  id: 'financial.ROUTING_NUMBER',
  name: 'ABA Routing Number',
  entityType: 'ROUTING_NUMBER',
  patterns: [
    /(?:routing\s*(?:number|no|#)?|ABA|RTN)\s*[:;#]?\s*\d{9}\b/gi,
  ],
  validate: (match) => {
    const digits = match.match(/\d{9}/);
    return digits ? validateABARouting(digits[0]) : false;
  },
  priority: 9,
};

const financialAmountDetector: EntityDetector = {
  id: 'financial.FINANCIAL_AMOUNT',
  name: 'Financial Amount with Context',
  entityType: 'FINANCIAL_AMOUNT',
  patterns: [
    // Context-dependent: "revenue of $1,234,567", "balance: $50,000.00", "salary $120,000", "wire $250,000"
    /(?:revenue|income|salary|compensation|balance|payment|invoice|amount|total|profit|loss|assets|liabilities|net\s+worth|loan|debt|mortgage|wire|transfer|deposit|withdraw(?:al)?|charge|fee|cost|price|budget)\s*(?:of|is|was|[:;])?\s*\$[\d,]+(?:\.\d{2})?\b/gi,
    // Large standalone amounts with dollar sign (>$10,000)
    /\$(?:[1-9]\d{1,2},)?(?:\d{3},)*\d{3}(?:\.\d{2})?\b/g,
  ],
  contextPatterns: [/(?:revenue|income|salary|compensation|balance|payment|financial|fiscal|budget|quarter|annual|wire|transfer|deposit|withdraw|charge|fee|cost|price|loan|debt|mortgage|invoice|amount|total|profit|loss|assets|liabilities)/i],
  priority: 6,
};

const swiftCodeDetector: EntityDetector = {
  id: 'financial.SWIFT_CODE',
  name: 'SWIFT/BIC Code',
  entityType: 'SWIFT_CODE',
  patterns: [
    /(?:SWIFT|BIC)\s*[:;]?\s*[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi,
  ],
  priority: 7,
};

export const financialDetectors: EntityDetector[] = [
  accountNumberDetector,
  routingNumberDetector,
  financialAmountDetector,
  swiftCodeDetector,
];

export const financialPack: CompliancePack = {
  id: 'financial',
  name: 'Financial / SOX',
  description: 'Detects and scrubs bank account numbers, routing numbers (ABA-validated), financial amounts with context, and SWIFT codes.',
  category: 'financial',
  detectors: financialDetectors,
};
