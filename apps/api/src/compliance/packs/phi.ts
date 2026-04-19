import type { CompliancePack, EntityDetector } from '../types.js';

const mrnDetector: EntityDetector = {
  id: 'phi.MRN',
  name: 'Medical Record Number',
  entityType: 'MRN',
  patterns: [
    /(?:MRN|medical\s+record(?:\s+number)?|patient\s+(?:id|number|#))\s*[:;#]?\s*[A-Z0-9]{4,12}\b/gi,
  ],
  priority: 9,
};

const healthPlanIdDetector: EntityDetector = {
  id: 'phi.HEALTH_PLAN_ID',
  name: 'Health Plan ID',
  entityType: 'HEALTH_PLAN_ID',
  patterns: [
    /(?:health\s+plan|insurance|member|policy|group)\s*(?:id|number|#|no)\s*[:;#]?\s*[A-Z0-9]{5,15}\b/gi,
  ],
  priority: 8,
};

const icdCodeDetector: EntityDetector = {
  id: 'phi.ICD_CODE',
  name: 'ICD Diagnosis Code',
  entityType: 'ICD_CODE',
  patterns: [
    // ICD-10 codes: A00-Z99 with optional decimal
    /(?:ICD[-\s]?10\s*[:;]?\s*)?[A-TV-Z]\d{2}(?:\.\d{1,4})?\b/g,
  ],
  contextPatterns: [/(?:diagnosis|ICD|dx|diagnosed|condition)\s*/i],
  priority: 7,
};

const cptCodeDetector: EntityDetector = {
  id: 'phi.CPT_CODE',
  name: 'CPT Procedure Code',
  entityType: 'CPT_CODE',
  patterns: [
    /(?:CPT\s*[:;]?\s*)?\b\d{5}\b/g,
  ],
  contextPatterns: [/(?:CPT|procedure|treatment|service\s+code)\s*/i],
  priority: 6,
};

const medicationDetector: EntityDetector = {
  id: 'phi.MEDICATION',
  name: 'Medication Name',
  entityType: 'MEDICATION',
  patterns: [
    // Context-dependent medication references
    /(?:prescribed|medication|medicine|drug|taking|dosage|rx)\s*[:;]?\s*[A-Z][a-z]+(?:[-\s][A-Z]?[a-z]+)*(?:\s+\d+\s*(?:mg|ml|mcg|g|units?))?/gi,
  ],
  priority: 5,
};

export const phiDetectors: EntityDetector[] = [
  mrnDetector,
  healthPlanIdDetector,
  icdCodeDetector,
  cptCodeDetector,
  medicationDetector,
];

export const phiPack: CompliancePack = {
  id: 'phi',
  name: 'PHI (Protected Health Information)',
  description: 'Detects and scrubs medical record numbers, health plan IDs, ICD/CPT codes, and medication references. Extends PII pack.',
  category: 'healthcare',
  detectors: phiDetectors,
  extends: ['pii'],
};
