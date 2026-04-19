/** Public-facing compliance pack info (no regex internals) */
export interface CompliancePackInfo {
  id: string;
  name: string;
  description: string;
  category: 'privacy' | 'financial' | 'healthcare' | 'education';
  detectorCount: number;
  detectors: ComplianceDetectorInfo[];
  extends?: string[];
}

export interface ComplianceDetectorInfo {
  id: string;
  name: string;
  entityType: string;
}

/** Org compliance configuration */
export interface OrgComplianceConfig {
  enabledPacks: string[];
  detectorOverrides?: Record<string, { enabled: boolean }>;
  auditLevel?: 'summary' | 'detailed';
  allowUserOverride?: boolean;
}

/** Compliance scrub statistics */
export interface ComplianceStats {
  totalScrubs: number;
  entityCounts: Record<string, number>;
  packUsage: Record<string, number>;
  period: string;
}

/** Dry-run test result */
export interface ComplianceTestResult {
  scrubbedText: string;
  entitiesFound: number;
  entities: Array<{
    type: string;
    original: string;
    placeholder: string;
  }>;
}
