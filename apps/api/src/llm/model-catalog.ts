import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CatalogModel } from '@hearth/shared';
import { logger } from '../lib/logger.js';

/**
 * Model catalog (models.dev-backed) — W1 of the opencode adaptation.
 *
 * Wave 0 lands the stable surface: a committed snapshot + `resolveModel`, which
 * **throws instead of silently falling back** (killing the undated
 * `claude-haiku-4-5` → gpt-4o bug). W1 will layer on the live models.dev fetch +
 * Redis caching behind `HEARTH_MODEL_CATALOG_REFRESH`; air-gapped installs keep
 * running entirely on the snapshot. See plans/opencode-adaptation-plan.md.
 */

/** Thrown when a model id is not present in the catalog. Never a silent fallback. */
export class UnknownModelError extends Error {
  readonly code = 'UNKNOWN_MODEL';
  constructor(public readonly modelId: string) {
    super(`Unknown model '${modelId}' — not present in the model catalog.`);
    this.name = 'UnknownModelError';
  }
}

interface SnapshotShape {
  models: Record<string, CatalogModel>;
}

let catalog: Map<string, CatalogModel> | null = null;

function loadSnapshot(): Map<string, CatalogModel> {
  const snapshotPath = path.resolve(import.meta.dirname, 'models.snapshot.json');
  const raw = readFileSync(snapshotPath, 'utf-8');
  const parsed = JSON.parse(raw) as SnapshotShape;
  const map = new Map<string, CatalogModel>();
  for (const [id, model] of Object.entries(parsed.models)) {
    map.set(id, model);
  }
  logger.info({ count: map.size }, 'Model catalog loaded from snapshot');
  return map;
}

function getCatalogMap(): Map<string, CatalogModel> {
  if (!catalog) catalog = loadSnapshot();
  return catalog;
}

/** All known models (snapshot + any live-refreshed entries). */
export function listCatalog(): CatalogModel[] {
  return [...getCatalogMap().values()];
}

/** True if the model id is known to the catalog. */
export function hasModel(id: string): boolean {
  return getCatalogMap().has(id);
}

/**
 * Resolve a model id to its catalog entry. Throws `UnknownModelError` if the id
 * is not known — callers must surface this to the user, never swap in a default.
 */
export function resolveModel(id: string): CatalogModel {
  const model = getCatalogMap().get(id);
  if (!model) throw new UnknownModelError(id);
  return model;
}

/**
 * W1 will implement the live models.dev refresh here (Redis-cached, gated by
 * `HEARTH_MODEL_CATALOG_REFRESH`). Wave 0 is snapshot-only.
 */
export async function refreshCatalog(): Promise<void> {
  // Intentionally a no-op in Wave 0 — the snapshot is authoritative until W1.
  return;
}

/** Test seam: force a reload (used by unit tests after mutating fixtures). */
export function __resetCatalogForTests(): void {
  catalog = null;
}
