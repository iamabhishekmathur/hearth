import type { CompliancePack, EntityDetector } from '../types.js';

/** Top common first names for context-aware name detection */
const COMMON_FIRST_NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'david', 'william', 'richard', 'joseph', 'thomas', 'charles',
  'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua',
  'kenneth', 'kevin', 'brian', 'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan',
  'mary', 'patricia', 'jennifer', 'linda', 'barbara', 'elizabeth', 'susan', 'jessica', 'sarah', 'karen',
  'lisa', 'nancy', 'betty', 'margaret', 'sandra', 'ashley', 'dorothy', 'kimberly', 'emily', 'donna',
  'michelle', 'carol', 'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia',
  'alexander', 'benjamin', 'samuel', 'nathan', 'peter', 'patrick', 'jack', 'henry', 'adam', 'noah',
  'emma', 'olivia', 'ava', 'sophia', 'isabella', 'mia', 'charlotte', 'amelia', 'harper', 'evelyn',
]);

const NAME_CONTEXT = /(?:(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sr|Jr|Rev)\.?\s+|(?:name\s+is|called|known\s+as|contact|patient|client|employee|student|user|author|signed\s+by|from|dear|hi|hello|hey)\s+)/i;

const ssnDetector: EntityDetector = {
  id: 'pii.SSN',
  name: 'Social Security Number',
  entityType: 'SSN',
  patterns: [/\b\d{3}-\d{2}-\d{4}\b/g],
  validate: (match) => {
    const digits = match.replace(/-/g, '');
    const area = parseInt(digits.substring(0, 3), 10);
    // SSN area numbers 000, 666, and 900-999 are invalid
    return area !== 0 && area !== 666 && area < 900;
  },
  priority: 10,
};

const emailDetector: EntityDetector = {
  id: 'pii.EMAIL',
  name: 'Email Address',
  entityType: 'EMAIL',
  patterns: [/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g],
  priority: 10,
};

const phoneDetector: EntityDetector = {
  id: 'pii.PHONE',
  name: 'Phone Number',
  entityType: 'PHONE',
  patterns: [
    // US formats: (555) 123-4567, 555-123-4567, +1-555-123-4567
    /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ],
  validate: (match) => {
    const digits = match.replace(/\D/g, '');
    // Must be 10 or 11 digits (with country code)
    return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
  },
  priority: 8,
};

const personNameDetector: EntityDetector = {
  id: 'pii.PERSON_NAME',
  name: 'Person Name',
  entityType: 'PERSON_NAME',
  // Match title + name or known-name context + capitalized words
  patterns: [
    // Title + name: "Mr. John Smith", "Dr. Jane Doe"
    /(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sr|Jr|Rev)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g,
    // Context + name: "name is John Smith", "patient John Smith"
    // Uses `g` only (not `i`) so [A-Z] requires actual uppercase. Context keywords use char classes for case flexibility.
    // First name word requires 3+ chars to avoid matching titles like "Dr" as names.
    /(?:[Nn]ame\s+[Ii]s|[Cc]alled|[Kk]nown\s+[Aa]s|[Cc]ontact|[Pp]atient|[Cc]lient|[Ee]mployee|[Ss]tudent|[Uu]ser|[Aa]uthor|[Ss]igned\s+[Bb]y|[Ff]rom|[Dd]ear|[Hh]i|[Hh]ello|[Hh]ey)\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+){0,2}/g,
  ],
  priority: 5,
};

const addressDetector: EntityDetector = {
  id: 'pii.ADDRESS',
  name: 'Street Address',
  entityType: 'ADDRESS',
  patterns: [
    // US street addresses: 123 Main St, 456 Oak Avenue, 742 Evergreen Terrace, etc.
    /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Rd|Road|Way|Ct|Court|Pl(?:ace)?|Cir(?:cle)?|Pkwy|Hwy|Terr(?:ace)?|Tr(?:ail)?|Path|Run|Row|Loop|Pass|Pike|Alley|Aly)\.?\b/gi,
  ],
  priority: 6,
};

const dobDetector: EntityDetector = {
  id: 'pii.DOB',
  name: 'Date of Birth',
  entityType: 'DOB',
  patterns: [
    // Context-dependent date: "born on 01/15/1990", "DOB: 1990-01-15", "date of birth: Jan 15, 1990"
    /(?:(?:date\s+of\s+birth|DOB|born\s+(?:on)?|birthday)\s*[:;]?\s*)(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/gi,
  ],
  priority: 7,
};

export const piiDetectors: EntityDetector[] = [
  ssnDetector,
  emailDetector,
  phoneDetector,
  personNameDetector,
  addressDetector,
  dobDetector,
];

export const piiPack: CompliancePack = {
  id: 'pii',
  name: 'PII (Personally Identifiable Information)',
  description: 'Detects and scrubs SSNs, email addresses, phone numbers, person names, addresses, and dates of birth.',
  category: 'privacy',
  detectors: piiDetectors,
};

/** Helper: check if a word is a common first name */
export function isCommonName(word: string): boolean {
  return COMMON_FIRST_NAMES.has(word.toLowerCase());
}

/** Helper: check if text near an index has name context signals */
export function hasNameContext(text: string, startIndex: number): boolean {
  // Look back up to 30 chars for context signals
  const prefix = text.substring(Math.max(0, startIndex - 30), startIndex);
  return NAME_CONTEXT.test(prefix);
}
