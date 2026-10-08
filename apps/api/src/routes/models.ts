import { Router } from 'express';
import type { CatalogModel, ModelPickerEntry, UserRole } from '@hearth/shared';
import { requireAuth, requireOrg } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';
import { isFeatureEnabled } from '../lib/feature-flags.js';
import {
  listCatalog,
  computeCost,
  resolveModel,
  ModelCapabilityError,
  UnknownModelError,
} from '../llm/model-catalog.js';

/**
 * W5 — In-chat model picker endpoint.
 *
 * `GET /api/v1/models` returns the catalog filtered to the org's **enabled
 * providers** and annotated with a per-role allowlist decision (`allowedForRole`)
 * plus a cheap `costHint`. The admin LLM config (`org.settings.llm`) stays the
 * single source of truth — this endpoint only *reads and enforces* it; it never
 * mutates settings. Gated behind the `modelPicker` feature flag.
 *
 * `assertModelAllowed` is exported for the send path (W-integration) to reject a
 * member picking a non-allowlisted / provider-disabled / non-vision model before
 * a run starts, reusing W1's typed errors.
 *
 * STRICT: this module only *imports* from `../llm/*` (W1 is read-only here) and
 * adds no migration — the per-role allowlist lives in the existing
 * `org.settings.llm.allowlist` JSON.
 */

// ── Org LLM settings shape (subset we read) ──────────────────────────────────

/** `'*'` means "all models"; otherwise an explicit list of model ids. */
export type RoleAllowlist = Record<string, string[] | '*'>;

export interface OrgLlmSettings {
  /** Encrypted provider keys keyed by provider id (presence ⇒ configured). */
  encryptedKeys?: Record<string, string>;
  /**
   * Optional explicit provider config (admin UI / seed fixture). When present it
   * is authoritative for which providers are enabled; otherwise enablement is
   * derived from configured keys (env or `encryptedKeys`).
   */
  providers?: Array<{ id?: string; provider?: string; enabled?: boolean; models?: string[] }>;
  /** Per-role allowlist: `{ role: ['modelId', ...] | '*' }`. Missing ⇒ all allowed. */
  allowlist?: RoleAllowlist;
  defaultModel?: string;
  defaultProvider?: string;
}

/** Read the `llm` bag out of an org's `settings` JSON (never throws). */
export function getOrgLlmSettings(settings: unknown): OrgLlmSettings {
  if (!settings || typeof settings !== 'object') return {};
  const llm = (settings as Record<string, unknown>).llm;
  if (!llm || typeof llm !== 'object') return {};
  return llm as OrgLlmSettings;
}

// ── Enabled providers ─────────────────────────────────────────────────────────

/** Provider ids with a configured key in the process env. */
function envEnabledProviders(): Set<string> {
  const ids = new Set<string>();
  if (env.ANTHROPIC_API_KEY) ids.add('anthropic');
  if (env.OPENAI_API_KEY) ids.add('openai');
  if (env.OLLAMA_BASE_URL) ids.add('ollama');
  return ids;
}

/**
 * Resolve the set of enabled provider ids for an org. If the admin stored an
 * explicit `providers[]` config, that is authoritative (only `enabled: true`
 * entries count). Otherwise enablement is derived from configured keys:
 * `org.settings.llm.encryptedKeys` ∪ env keys.
 */
export function enabledProviderIds(
  llm: OrgLlmSettings,
  envProviders: Set<string> = envEnabledProviders(),
): Set<string> {
  if (Array.isArray(llm.providers)) {
    const ids = new Set<string>();
    for (const p of llm.providers) {
      const id = p.id ?? p.provider;
      if (id && p.enabled) ids.add(id);
    }
    return ids;
  }
  const ids = new Set<string>(envProviders);
  for (const id of Object.keys(llm.encryptedKeys ?? {})) ids.add(id);
  return ids;
}

// ── Cost hint ─────────────────────────────────────────────────────────────────

/**
 * Derive a cheap `$`/`$$`/`$$$` hint from catalog pricing. Uses W1's
 * `computeCost` against a fixed reference usage (blended 1M in + 1M out) so the
 * hint tracks the same pricing the cost meter uses. Returns `undefined` when the
 * model has no pricing.
 */
export function costHintFor(modelId: string): string | undefined {
  const cost = computeCost(modelId, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  if (cost === undefined) return undefined;
  // Thresholds on blended $/2M tokens: tuned so haiku/gpt-4o-mini → $, mid → $$,
  // frontier (opus/sonnet) → $$$.
  if (cost < 8) return '$';
  if (cost < 18) return '$$';
  return '$$$';
}

// ── Allowlist ─────────────────────────────────────────────────────────────────

/** The allowlist entry for a role: `'*'` (all), a list, or `undefined` (default all). */
function allowlistForRole(llm: OrgLlmSettings, role: UserRole): string[] | '*' | undefined {
  return llm.allowlist?.[role];
}

/**
 * Whether a role may select `modelId` under the org allowlist. A missing
 * allowlist (or a missing entry for the role) defaults to **allowed** — the
 * allowlist is opt-in cost governance, not a deny-by-default gate.
 */
export function isModelAllowedForRole(llm: OrgLlmSettings, role: UserRole, modelId: string): boolean {
  const entry = allowlistForRole(llm, role);
  if (entry === undefined || entry === '*') return true;
  return entry.includes(modelId);
}

/** Thrown when a model is not selectable for the org/role (provider off or allowlist). */
export class ModelNotAllowedError extends Error {
  readonly code: 'MODEL_PROVIDER_DISABLED' | 'MODEL_NOT_ALLOWLISTED';
  readonly status = 403;
  constructor(
    public readonly modelId: string,
    reason: 'provider_disabled' | 'not_allowlisted',
  ) {
    super(
      reason === 'provider_disabled'
        ? `Model '${modelId}' belongs to a provider that is not enabled for this org.`
        : `Model '${modelId}' is not allowed for your role.`,
    );
    this.name = 'ModelNotAllowedError';
    this.code = reason === 'provider_disabled' ? 'MODEL_PROVIDER_DISABLED' : 'MODEL_NOT_ALLOWLISTED';
  }
}

/**
 * Reusable gate for the send path: assert a user may send with `modelId`.
 *
 * Throws (surface to the client, never silently swap a default):
 *  - `UnknownModelError` — model id not in catalog (W1).
 *  - `ModelNotAllowedError` (403) — provider disabled OR not allowlisted for role.
 *  - `ModelCapabilityError` (`MODEL_NO_VISION`, 422) — when `requireVision` is set
 *    (an image attachment is present) and the model has `caps.vision === false`.
 */
export function assertModelAllowed(
  settings: unknown,
  role: UserRole,
  modelId: string,
  opts: { requireVision?: boolean } = {},
): CatalogModel {
  const llm = getOrgLlmSettings(settings);
  const model = resolveModel(modelId); // throws UnknownModelError on a miss
  const enabled = enabledProviderIds(llm);
  if (!enabled.has(model.providerId)) {
    throw new ModelNotAllowedError(modelId, 'provider_disabled');
  }
  if (!isModelAllowedForRole(llm, role, modelId)) {
    throw new ModelNotAllowedError(modelId, 'not_allowlisted');
  }
  if (opts.requireVision && !model.caps.vision) {
    throw new ModelCapabilityError(modelId, 'vision');
  }
  return model;
}

// ── Picker entries ──────────────────────────────────────────────────────────

/**
 * Build the `ModelPickerEntry[]` for a role: the catalog filtered to the org's
 * enabled providers, each annotated with `costHint` + `allowedForRole`. Models
 * whose provider is disabled are **omitted** entirely; models blocked only by the
 * role allowlist are **included** with `allowedForRole: false` so the UI can show
 * them greyed-out with a reason.
 */
export function buildModelPickerEntries(args: {
  catalog: CatalogModel[];
  settings: unknown;
  role: UserRole;
}): ModelPickerEntry[] {
  const llm = getOrgLlmSettings(args.settings);
  const enabled = enabledProviderIds(llm);
  return args.catalog
    .filter((m) => enabled.has(m.providerId))
    .map((m) => {
      const entry: ModelPickerEntry = {
        ...m,
        allowedForRole: isModelAllowedForRole(llm, args.role, m.id),
      };
      const hint = costHintFor(m.id);
      if (hint) entry.costHint = hint;
      return entry;
    });
}

// ── Router ─────────────────────────────────────────────────────────────────

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/v1/models — the in-chat picker catalog for the current user's org +
 * role. Returns `ModelPickerEntry[]`. Empty array when no providers are enabled
 * (the UI renders an actionable empty state). Gated behind `modelPicker`.
 */
router.get('/', requireAuth, requireOrg, async (req, res, next) => {
  try {
    const org = await prisma.org.findUnique({
      where: { id: req.user!.orgId! },
      select: { settings: true },
    });

    if (!isFeatureEnabled(org?.settings, 'modelPicker')) {
      res.status(404).json({ error: 'Model picker is not enabled for this org.' });
      return;
    }

    const entries = buildModelPickerEntries({
      catalog: listCatalog(),
      settings: org?.settings,
      role: req.user!.role,
    });

    res.json({ data: entries });
  } catch (err) {
    next(err);
  }
});

// Re-export typed errors so a shared error handler / the send path can map them.
export { ModelCapabilityError, UnknownModelError };

export default router;
