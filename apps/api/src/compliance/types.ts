import type { ChatParams, ChatEvent } from '@hearth/shared';

/** A single entity detector within a compliance pack */
export interface EntityDetector {
  /** Unique ID within pack, e.g. 'pii.SSN' */
  id: string;
  /** Human-readable name */
  name: string;
  /** Entity type for token naming, e.g. 'SSN', 'PERSON_NAME' */
  entityType: string;
  /** Regex patterns to match */
  patterns: RegExp[];
  /** Optional validation function (e.g., Luhn check for credit cards) */
  validate?: (match: string) => boolean;
  /** Optional context patterns that increase confidence for ambiguous matches */
  contextPatterns?: RegExp[];
  /** Priority — higher runs first, useful when patterns overlap */
  priority?: number;
}

/** A compliance pack is a named collection of entity detectors */
export interface CompliancePack {
  id: string;
  name: string;
  description: string;
  category: 'privacy' | 'financial' | 'healthcare' | 'education';
  detectors: EntityDetector[];
  /** IDs of other packs this one extends */
  extends?: string[];
}

/** Org-level compliance configuration, stored in org.settings.compliance */
export interface OrgComplianceConfig {
  enabledPacks: string[];
  detectorOverrides?: Record<string, { enabled: boolean }>;
  auditLevel?: 'summary' | 'detailed';
  allowUserOverride?: boolean;
}

/** A single detected entity in text */
export interface DetectedEntity {
  detectorId: string;
  entityType: string;
  originalValue: string;
  placeholder: string;
  startIndex: number;
  endIndex: number;
}

/** Session-scoped mapping of placeholders to original values */
export interface TokenMap {
  /** placeholder -> original value */
  toOriginal: Map<string, string>;
  /** original value -> placeholder */
  toPlaceholder: Map<string, string>;
  /** Counter per entity type for deterministic numbering */
  counters: Map<string, number>;
}

/** Result of a scrubbing operation */
export interface ScrubResult {
  scrubbedText: string;
  entities: DetectedEntity[];
  tokenMap: TokenMap;
}

/** Chat-level scrub result with modified params */
export interface ChatScrubResult {
  scrubbedParams: ChatParams;
  tokenMap: TokenMap;
  totalEntities: number;
  entityCounts: Record<string, number>;
}

/** Interceptor function types for ProviderRegistry */
export type ChatInterceptor = (
  params: ChatParams,
  preferredId: string | undefined,
  realChat: (params: ChatParams, preferredId?: string) => AsyncIterable<ChatEvent>,
) => AsyncIterable<ChatEvent>;

export type EmbedInterceptor = (
  texts: string[],
  preferredId: string | undefined,
  realEmbed: (texts: string[], preferredId?: string) => Promise<number[][] | null>,
) => Promise<number[][] | null>;
