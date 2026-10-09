import type { OrgFeatureFlags, OrgFeatureFlag } from '@hearth/shared';

/**
 * Per-org feature flags for the agent-loop modernization effort. Stored under
 * `org.settings.features` (JSONB — no migration needed). Each workstream
 * (W2–W6) dark-launches behind its flag and only defaults on after its
 * regression suite passes. See plans/opencode-adaptation-plan.md.
 */

/** Extract the typed feature-flag bag from an org's `settings` JSON. */
export function getOrgFeatureFlags(
  settings: unknown,
): OrgFeatureFlags {
  if (!settings || typeof settings !== 'object') return {};
  const features = (settings as Record<string, unknown>).features;
  if (!features || typeof features !== 'object') return {};
  return features as OrgFeatureFlags;
}

/**
 * Whether a given feature is enabled for an org. Defaults to `false` — new
 * surfaces are off until explicitly enabled.
 */
export function isFeatureEnabled(
  settings: unknown,
  flag: OrgFeatureFlag,
): boolean {
  return getOrgFeatureFlags(settings)[flag] === true;
}
