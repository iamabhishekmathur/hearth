import type { CompliancePack, EntityDetector } from '../types.js';

const studentIdDetector: EntityDetector = {
  id: 'ferpa.STUDENT_ID',
  name: 'Student ID',
  entityType: 'STUDENT_ID',
  patterns: [
    /(?:student\s+(?:id|number|#|no)|SID)\s*[:;#]?\s*[A-Z0-9]{4,12}\b/gi,
  ],
  priority: 9,
};

const gradeDetector: EntityDetector = {
  id: 'ferpa.GRADE',
  name: 'Grade/GPA',
  entityType: 'GRADE',
  patterns: [
    // GPA: "GPA: 3.85", "GPA of 3.5"
    /(?:GPA|grade\s+point\s+average)\s*[:;]?\s*(?:of\s+)?\d\.\d{1,2}\b/gi,
    // Letter grades with context: "grade: A+", "received a B-"
    /(?:grade|scored|received|earned|got)\s*[:;]?\s*(?:an?\s+)?[A-DF][+-]?\b/gi,
  ],
  priority: 7,
};

const enrollmentDetector: EntityDetector = {
  id: 'ferpa.ENROLLMENT',
  name: 'Enrollment Information',
  entityType: 'ENROLLMENT',
  patterns: [
    // Enrollment status with context
    /(?:enroll(?:ed|ment)?|matriculat(?:ed|ion)|register(?:ed)?)\s+(?:in|at|for)\s+[A-Z][A-Za-z\s]+(?:University|College|School|Institute|Academy)/gi,
    // Course enrollment: "enrolled in CS 101"
    /(?:enroll(?:ed|ment)?|register(?:ed)?)\s+(?:in|for)\s+[A-Z]{2,4}\s*\d{3,4}\b/gi,
  ],
  priority: 6,
};

const transcriptDetector: EntityDetector = {
  id: 'ferpa.TRANSCRIPT',
  name: 'Transcript Data',
  entityType: 'TRANSCRIPT',
  patterns: [
    // Transcript references with specific data
    /(?:transcript|academic\s+record|course\s+record)\s*[:;]?\s*.{5,50}/gi,
  ],
  priority: 5,
};

export const ferpaDetectors: EntityDetector[] = [
  studentIdDetector,
  gradeDetector,
  enrollmentDetector,
  transcriptDetector,
];

export const ferpaPack: CompliancePack = {
  id: 'ferpa',
  name: 'FERPA (Family Educational Rights and Privacy)',
  description: 'Detects and scrubs student IDs, grades/GPA, enrollment information, and transcript data.',
  category: 'education',
  detectors: ferpaDetectors,
};
