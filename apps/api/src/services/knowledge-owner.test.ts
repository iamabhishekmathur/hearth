import { describe, it, expect } from 'vitest';
import { isMemoryOwner, isRoutineOwner, type KnowledgeActor } from './knowledge-owner.js';

const ORG = 'org-1';
const TEAM = 'team-1';
const OTHER_TEAM = 'team-2';

const actor = (
  role: string,
  userId: string,
  teamId: string | null = TEAM,
  orgId = ORG,
): KnowledgeActor => ({
  userId,
  role,
  teamId,
  orgId,
});

const admin = actor('admin', 'u-admin');
const lead = actor('team_lead', 'u-lead');
const otherLead = actor('team_lead', 'u-other-lead', OTHER_TEAM);
const member = actor('member', 'u-member');
const viewer = actor('viewer', 'u-viewer');
const rivalAdmin = actor('admin', 'u-rival', 'rival-team', 'org-rival');

const mem = (
  layer: string,
  extra: Partial<{ teamId: string | null; userId: string | null; ownerId: string | null }> = {},
) => ({
  layer,
  orgId: ORG,
  teamId: extra.teamId ?? (layer === 'team' ? TEAM : null),
  userId: extra.userId ?? (layer === 'user' || layer === 'session' ? 'u-member' : null),
  ownerId: extra.ownerId ?? null,
});

describe('isMemoryOwner — default owners by layer', () => {
  it.each([
    ['org', admin, true],
    ['org', lead, false],
    ['org', member, false],
    ['org', viewer, false],
    ['team', admin, true],
    ['team', lead, true],
    ['team', otherLead, false],
    ['team', member, false],
    ['team', viewer, false],
    ['user', member, true],
    ['user', admin, false],
    ['user', lead, false],
  ] as const)('%s layer, %s → %s', (layer, who, expected) => {
    expect(isMemoryOwner(who, mem(layer))).toBe(expected);
  });

  it('never grants ownership across orgs, even to an admin', () => {
    expect(isMemoryOwner(rivalAdmin, mem('org'))).toBe(false);
  });

  it('treats an actor with no org as never an owner', () => {
    expect(isMemoryOwner({ ...admin, orgId: null }, mem('org'))).toBe(false);
  });
});

describe('isMemoryOwner — explicit owner', () => {
  it('adds the named owner to the default owners', () => {
    const entry = mem('org', { ownerId: 'u-member' });
    expect(isMemoryOwner(member, entry)).toBe(true);
    expect(isMemoryOwner(admin, entry)).toBe(true); // admins keep their rights
    expect(isMemoryOwner(lead, entry)).toBe(false);
  });

  it('does not let a named owner from another org through', () => {
    const entry = mem('org', { ownerId: 'u-rival' });
    expect(isMemoryOwner(rivalAdmin, entry)).toBe(false);
  });
});

const routine = (
  scope: string,
  extra: Partial<{
    teamId: string | null;
    userId: string;
    ownerId: string | null;
    orgId: string | null;
  }> = {},
) => ({
  scope,
  orgId: extra.orgId === undefined ? ORG : extra.orgId,
  teamId: extra.teamId ?? (scope === 'team' ? TEAM : null),
  userId: extra.userId ?? 'u-member',
  ownerId: extra.ownerId ?? null,
});

describe('isRoutineOwner — mirrors the routine edit rule', () => {
  it.each([
    ['org', admin, true],
    ['org', lead, false],
    ['org', member, false],
    ['team', admin, true],
    ['team', lead, true],
    ['team', otherLead, false],
    ['team', member, false],
    ['personal', member, true],
    ['personal', admin, false],
  ] as const)('%s routine, %s → %s', (scope, who, expected) => {
    expect(isRoutineOwner(who, routine(scope))).toBe(expected);
  });

  it('an admin on another team does not own a team routine', () => {
    const otherTeamAdmin = actor('admin', 'u-admin-2', OTHER_TEAM);
    expect(isRoutineOwner(otherTeamAdmin, routine('team'))).toBe(false);
  });

  it('a named owner owns the routine', () => {
    expect(isRoutineOwner(member, routine('team', { ownerId: 'u-member' }))).toBe(true);
  });

  it('never crosses orgs', () => {
    expect(isRoutineOwner(rivalAdmin, routine('org'))).toBe(false);
    expect(isRoutineOwner(rivalAdmin, routine('org', { ownerId: 'u-rival' }))).toBe(false);
  });

  it('a legacy personal routine with no org is owned by its person', () => {
    expect(isRoutineOwner(member, routine('personal', { orgId: null }))).toBe(true);
  });
});
