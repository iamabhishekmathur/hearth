import type { CompliancePack, EntityDetector } from '../types.js';
import { piiPack } from './pii.js';
import { pciPack } from './pci-dss.js';
import { phiPack } from './phi.js';
import { gdprPack } from './gdpr.js';
import { ferpaPack } from './ferpa.js';
import { financialPack } from './financial.js';

const ALL_PACKS: CompliancePack[] = [
  piiPack,
  pciPack,
  phiPack,
  gdprPack,
  ferpaPack,
  financialPack,
];

const packMap = new Map<string, CompliancePack>(
  ALL_PACKS.map((p) => [p.id, p]),
);

/** Get all available compliance packs */
export function getAvailablePacks(): CompliancePack[] {
  return ALL_PACKS;
}

/** Get a single pack by ID */
export function getPackById(id: string): CompliancePack | undefined {
  return packMap.get(id);
}

/**
 * Resolve a list of pack IDs into a deduplicated, flattened list of detectors.
 * Follows `extends` chains to include parent pack detectors.
 */
export function resolveDetectors(
  packIds: string[],
  overrides?: Record<string, { enabled: boolean }>,
): EntityDetector[] {
  const seen = new Set<string>();
  const detectors: EntityDetector[] = [];

  function collectPack(id: string) {
    if (seen.has(id)) return;
    seen.add(id);

    const pack = packMap.get(id);
    if (!pack) return;

    // Resolve parent packs first
    if (pack.extends) {
      for (const parentId of pack.extends) {
        collectPack(parentId);
      }
    }

    for (const detector of pack.detectors) {
      // Check overrides
      if (overrides?.[detector.id]?.enabled === false) continue;
      // Deduplicate by detector ID (parent pack detectors already added)
      if (!detectors.some((d) => d.id === detector.id)) {
        detectors.push(detector);
      }
    }
  }

  for (const packId of packIds) {
    collectPack(packId);
  }

  // Sort by priority (higher first)
  detectors.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return detectors;
}
