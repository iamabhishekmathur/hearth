import { describe, it, expect } from 'vitest';
import { ferpaDetectors } from './ferpa.js';
import { detectEntities } from '../scrubber.js';

describe('FERPA Pack Detectors', () => {
  describe('Student ID', () => {
    it('detects student ID', () => {
      const entities = detectEntities('student id: STU12345', ferpaDetectors);
      expect(entities.some((e) => e.entityType === 'STUDENT_ID')).toBe(true);
    });

    it('detects SID', () => {
      const entities = detectEntities('SID: 987654321', ferpaDetectors);
      expect(entities.some((e) => e.entityType === 'STUDENT_ID')).toBe(true);
    });
  });

  describe('Grade', () => {
    it('detects GPA', () => {
      const entities = detectEntities('GPA: 3.85', ferpaDetectors);
      expect(entities.some((e) => e.entityType === 'GRADE')).toBe(true);
    });

    it('detects letter grade with context', () => {
      const entities = detectEntities('received an A+', ferpaDetectors);
      expect(entities.some((e) => e.entityType === 'GRADE')).toBe(true);
    });
  });

  describe('Enrollment', () => {
    it('detects enrollment in university', () => {
      const entities = detectEntities('enrolled at Stanford University', ferpaDetectors);
      expect(entities.some((e) => e.entityType === 'ENROLLMENT')).toBe(true);
    });

    it('detects course enrollment', () => {
      const entities = detectEntities('enrolled in CS 101', ferpaDetectors);
      expect(entities.some((e) => e.entityType === 'ENROLLMENT')).toBe(true);
    });
  });
});
