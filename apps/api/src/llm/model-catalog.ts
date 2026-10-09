import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CatalogModel } from '@hearth/shared';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { env } from '../config.js';

/**
 * Model catalog (models.dev-backed) — W1 of the opencode adaptation.
 *
 * The committed snapshot (`models.snapshot.json`) is authoritative and always
 * loaded at boot, so self-host/air-gapped installs are fully functional with no
 * network. When `HEARTH_MODEL_CATALOG_REFRESH=true`, a live models.dev fetch is
 * layered on top (Redis-cached, 24h TTL); any failure falls back cleanly to the
 * snapshot with a single warning (never per-request).
 *
 * `resolveModel` **throws `UnknownModelError` instead of silently falling back**,
 * killing the undated `claude-haiku-4-5` → gpt-4o bug. There is NO silent
 * default anywhere in this module. See plans/opencode-adaptation-plan.md (W1).
 */

const MODELS_DEV_URL = 'https://models.dev/api.json';
const REDIS_CACHE_KEY = 'model-catalog:v1';
const REDIS_TTL_SECONDS = 24 * 60 * 60; // 24h

/** Thrown when a model id is not present in the catalog. Never a silent fallback. */
export class UnknownModelError extends Error {
  readonly code = 'UNKNOWN_MODEL';
  constructor(public readonly modelId: string) {
    super(`Unknown model '${modelId}' — not present in the model catalog.`);
    this.name = 'UnknownModelError';
  }
}

/** Thrown when a model's required capability is missing (vision/tools gating). */
export class ModelCapabilityError extends Error {
  readonly code: 'MODEL_NO_VISION' | 'MODEL_NO_TOOLS';
  constructor(
    public readonly modelId: string,
    capability: 'vision' | 'tools',
  ) {
    super(`Model '${modelId}' does not support ${capability}.`);
    this.name = 'ModelCapabilityError';
    this.code = capability === 'vision' ? 'MODEL_NO_VISION' : 'MODEL_NO_TOOLS';
  }
}

interface SnapshotShape {
  models: Record<string, CatalogModel>;
}

let catalog: Map<string, CatalogModel> | null = null;
let refreshWarned = false;

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

// ── Resolution chain (W1) ──────────────────────────────────────────────────────

/**
 * Ordered candidate model ids. Named for clarity; the chain is validated most-
 * specific first: skill recommendation → request → user pref → team default →
 * org default. Undefined/empty steps are skipped.
 */
export interface ModelResolutionChain {
  skillRecommended?: string | null;
  requested?: string | null;
  userPreference?: string | null;
  teamDefault?: string | null;
  orgDefault?: string | null;
}

/**
 * Resolve the effective model from the precedence chain. The FIRST step that is
 * present is used — and it is validated against the catalog, throwing
 * `UnknownModelError` on a miss. There is **no silent fallback to a later step**:
 * a present-but-unknown id is a hard error so the bad id surfaces to the user
 * (this is the headline fix — an undated/typo'd id can never quietly become a
 * different model). Throws `UnknownModelError('<none>')` if the chain is empty.
 */
export function resolveFromChain(chain: ModelResolutionChain): CatalogModel {
  const ordered: Array<string | null | undefined> = [
    chain.skillRecommended,
    chain.requested,
    chain.userPreference,
    chain.teamDefault,
    chain.orgDefault,
  ];
  for (const candidate of ordered) {
    if (candidate) return resolveModel(candidate);
  }
  throw new UnknownModelError('<none>');
}

// ── Capability gating (W1) ──────────────────────────────────────────────────────

/** True if the model supports image input. */
export function supportsVision(id: string): boolean {
  return resolveModel(id).caps.vision;
}

/** True if the model supports tool/function calling. */
export function supportsTools(id: string): boolean {
  return resolveModel(id).caps.tools;
}

/**
 * Assert the model supports image input; throws `ModelCapabilityError`
 * (`MODEL_NO_VISION`) otherwise. Use before sending image attachments.
 */
export function assertVision(id: string): void {
  if (!resolveModel(id).caps.vision) throw new ModelCapabilityError(id, 'vision');
}

/**
 * Assert the model supports tool use; throws `ModelCapabilityError`
 * (`MODEL_NO_TOOLS`) otherwise. Use before sending tool definitions.
 */
export function assertTools(id: string): void {
  if (!resolveModel(id).caps.tools) throw new ModelCapabilityError(id, 'tools');
}

// ── Cost (W1) ────────────────────────────────────────────────────────────────

/**
 * Compute the USD cost of a call from catalog pricing. Returns `undefined` when
 * the model has no pricing in the catalog. Pricing is per 1M tokens.
 */
export function computeCost(
  id: string,
  usage: { inputTokens: number; outputTokens: number },
): number | undefined {
  const pricing = resolveModel(id).pricing;
  if (!pricing) return undefined;
  const inCost = ((pricing.inputPer1M ?? 0) * usage.inputTokens) / 1_000_000;
  const outCost = ((pricing.outputPer1M ?? 0) * usage.outputTokens) / 1_000_000;
  return inCost + outCost;
}

// ── Live models.dev refresh (W1) ────────────────────────────────────────────────

/** Shape of the models.dev `api.json` (a subset — we only read what we map). */
interface ModelsDevModel {
  id?: string;
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  tool_call?: boolean;
  reasoning?: boolean;
  cost?: { input?: number; output?: number };
}
interface ModelsDevProvider {
  id?: string;
  models?: Record<string, ModelsDevModel>;
}
type ModelsDevApi = Record<string, ModelsDevProvider>;

/** Map one models.dev provider block into `CatalogModel` entries. */
function mapModelsDev(api: ModelsDevApi): Map<string, CatalogModel> {
  const map = new Map<string, CatalogModel>();
  for (const [providerKey, provider] of Object.entries(api)) {
    const providerId = provider.id ?? providerKey;
    for (const [modelKey, model] of Object.entries(provider.models ?? {})) {
      const id = model.id ?? modelKey;
      const inputModalities = model.modalities?.input ?? [];
      const entry: CatalogModel = {
        id,
        providerId,
        contextWindow: model.limit?.context ?? 0,
        caps: {
          vision: inputModalities.includes('image'),
          tools: model.tool_call ?? false,
          reasoning: model.reasoning ?? false,
        },
      };
      if (model.cost && (model.cost.input != null || model.cost.output != null)) {
        entry.pricing = {
          ...(model.cost.input != null ? { inputPer1M: model.cost.input } : {}),
          ...(model.cost.output != null ? { outputPer1M: model.cost.output } : {}),
        };
      }
      map.set(id, entry);
    }
  }
  return map;
}

/**
 * Refresh the catalog from models.dev, Redis-cached. Gated by
 * `HEARTH_MODEL_CATALOG_REFRESH` — a no-op (snapshot-only) when disabled. Any
 * failure (network blocked, bad JSON, Redis down) is swallowed with at most one
 * warning and leaves the snapshot in place, so air-gapped installs are never
 * disrupted and the per-request path never pays for a failed fetch.
 */
export async function refreshCatalog(): Promise<void> {
  if (!env.HEARTH_MODEL_CATALOG_REFRESH) return; // snapshot-only (self-host default)

  // Seed from snapshot so a partial refresh never drops known models.
  const merged = new Map(getCatalogMap());

  // 1. Try the Redis cache first.
  try {
    const cached = await redis.get(REDIS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, CatalogModel>;
      for (const [id, m] of Object.entries(parsed)) merged.set(id, m);
      catalog = merged;
      logger.info({ count: merged.size }, 'Model catalog refreshed from Redis cache');
      return;
    }
  } catch (err) {
    logger.debug({ err }, 'Model catalog Redis cache read failed; fetching from models.dev');
  }

  // 2. Fetch live from models.dev and populate the cache.
  try {
    const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    const api = (await res.json()) as ModelsDevApi;
    const live = mapModelsDev(api);
    if (live.size === 0) throw new Error('models.dev returned no models');

    for (const [id, m] of live) merged.set(id, m);
    catalog = merged;

    const serialized = JSON.stringify(Object.fromEntries(merged));
    await redis.set(REDIS_CACHE_KEY, serialized, 'EX', REDIS_TTL_SECONDS).catch(() => {});
    logger.info({ count: merged.size }, 'Model catalog refreshed from models.dev');
  } catch (err) {
    if (!refreshWarned) {
      refreshWarned = true;
      logger.warn(
        { err },
        'models.dev refresh failed — running on the committed snapshot. This warning is logged once.',
      );
    }
    // Leave the snapshot-backed catalog in place.
  }
}

/** Test seam: force a reload (used by unit tests after mutating fixtures). */
export function __resetCatalogForTests(): void {
  catalog = null;
  refreshWarned = false;
}

/** Test seam: directly seed the in-memory catalog (used by unit tests). */
export function __setCatalogForTests(models: CatalogModel[]): void {
  catalog = new Map(models.map((m) => [m.id, m]));
}
