/**
 * The daily digest: one notification per person per day, at 9am in their
 * timezone. It carries up to two parts:
 *
 *   1. the org's activity summary (unchanged from before Phase 3);
 *   2. Knowledge loop, Phase 3 (org flag `knowledgeLoop`): for an owner with
 *      cards waiting, ONE line ("3 proposals wait in Review"), the one 7-day
 *      reminder per card, and — for admins on Monday — one weekly line.
 *
 * A person with both parts gets ONE notification with both. A person with
 * neither gets nothing. Email follows the person's switches: the activity
 * part is emailed as before (when email is configured); the knowledge part
 * only when the person turned `knowledgeEmail` on. A failed email never
 * stops the in-app item.
 *
 * Timezone: `User.preferences.timezone` (IANA name). No timezone, or an
 * invalid one, means UTC — the one documented default.
 */
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { isFeatureEnabled } from '../lib/feature-flags.js';
import { generateDigest } from './activity-feed-service.js';
import * as notificationService from './notification-service.js';
import * as emailService from './email-service.js';
import { getPreferencesFor } from './notification-preferences.js';
import {
  adminWeeklyLine,
  cardsDueForReminder,
  cardsFor,
  getAdminSummary,
  loadPendingCards,
  markReminded,
  ownerSummaryLine,
  reminderLine,
  type OrgCard,
} from './knowledge-notify.js';
import type { KnowledgeAdminSummary } from '@hearth/shared';

export const DEFAULT_TIMEZONE = 'UTC';
export const DIGEST_HOUR = 9;
/** A second run in the same window (a retry) must not send a second digest. */
const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000;

// ── Pure helpers ──────────────────────────────────────────────────────────

export function timezoneOf(preferences: unknown): string {
  const tz = (preferences as Record<string, unknown> | null)?.timezone;
  if (typeof tz !== 'string' || !tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Local hour (0–23) and weekday ("Mon"…"Sun") of `now` in `tz`. */
export function localTime(tz: string, now: Date): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? now.getUTCHours());
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return { hour: hour === 24 ? 0 : hour, weekday };
}

export interface ComposedDigest {
  title: string;
  body: string | null;
  entityType: 'org' | 'review';
}

/**
 * Pure: one notification from the parts. Knowledge lines come first in the
 * body (the bell shows the first line) and make the item open Review.
 */
export function composeDigest(input: {
  orgName: string;
  activity: string | null;
  knowledgeLines: string[];
}): ComposedDigest | null {
  const lines = input.knowledgeLines.filter((l) => l.trim().length > 0);
  if (!input.activity && lines.length === 0) return null;
  const entityType = lines.length > 0 ? 'review' : 'org';
  if (input.activity) {
    return {
      title: `Daily Activity Digest — ${input.orgName}`,
      body: [...lines, input.activity].join('\n\n'),
      entityType,
    };
  }
  const [first, ...rest] = lines;
  return { title: first, body: rest.length ? rest.join('\n') : null, entityType };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── The run ───────────────────────────────────────────────────────────────

export type ActivityDigestFn = (
  orgId: string,
  since: Date,
) => Promise<{ summary: string; eventCount: number }>;

export interface DailyDigestOptions {
  now?: Date;
  orgId?: string;
  /** The activity summary (an LLM call in production). */
  activityDigest?: ActivityDigestFn;
}

export interface DailyDigestOrgResult {
  orgId: string;
  /** Digest notifications created. */
  delivered: number;
  /** Of those, how many carried a knowledge line. */
  knowledgeItems: number;
  /** Cards whose one reminder went out in this run. */
  reminded: number;
  emailed: number;
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  preferences: unknown;
}

export async function runDailyDigest(
  opts: DailyDigestOptions = {},
): Promise<DailyDigestOrgResult[]> {
  const now = opts.now ?? new Date();
  const activityDigest = opts.activityDigest ?? generateDigest;
  const orgs = opts.orgId
    ? await prisma.org.findMany({ where: { id: opts.orgId } })
    : await prisma.org.findMany();
  const results: DailyDigestOrgResult[] = [];

  for (const org of orgs) {
    const members: Member[] = await prisma.user.findMany({
      where: { team: { orgId: org.id } },
      select: { id: true, name: true, email: true, role: true, teamId: true, preferences: true },
    });

    const local = new Map<string, { hour: number; weekday: string }>();
    for (const m of members) local.set(m.id, localTime(timezoneOf(m.preferences), now));
    let due = members.filter((m) => local.get(m.id)!.hour === DIGEST_HOUR);
    if (due.length === 0) continue;

    // Retries in the same window must not double-send.
    const already = await prisma.notification.findMany({
      where: {
        userId: { in: due.map((m) => m.id) },
        type: 'digest',
        createdAt: { gt: new Date(now.getTime() - DEDUP_WINDOW_MS), lte: now },
      },
      select: { userId: true },
    });
    const sent = new Set(already.map((n) => n.userId));
    due = due.filter((m) => !sent.has(m.id));
    if (due.length === 0) continue;

    let activity: string | null = null;
    try {
      const d = await activityDigest(org.id, new Date(now.getTime() - 24 * 60 * 60 * 1000));
      if (d.eventCount > 0) activity = d.summary;
    } catch (err) {
      logger.warn({ errName: (err as Error)?.name, orgId: org.id }, 'Activity digest failed');
    }

    const knowledgeOn = isFeatureEnabled(org.settings, 'knowledgeLoop');
    const prefs = knowledgeOn ? await getPreferencesFor(due) : null;
    const cards: OrgCard[] = knowledgeOn ? await loadPendingCards(org.id, now) : [];
    let adminSummary: KnowledgeAdminSummary | null = null;

    const reminderIds = new Set<string>();
    const result: DailyDigestOrgResult = {
      orgId: org.id,
      delivered: 0,
      knowledgeItems: 0,
      reminded: 0,
      emailed: 0,
    };
    const emailReady = emailService.isEmailConfigured();

    for (const member of due) {
      const knowledgeLines: string[] = [];
      const p = prefs?.get(member.id);
      if (knowledgeOn && p) {
        if (p.knowledgeSummary && cards.length > 0) {
          const mine = cardsFor(
            { userId: member.id, orgId: org.id, teamId: member.teamId, role: member.role },
            cards,
          );
          const line = ownerSummaryLine(mine);
          if (line) knowledgeLines.push(line);
          const remind = cardsDueForReminder(mine, now);
          const rLine = reminderLine(remind);
          if (rLine) {
            knowledgeLines.push(rLine);
            for (const c of remind) reminderIds.add(c.id);
          }
        }
        if (
          member.role === 'admin' &&
          p.adminWeeklySummary &&
          local.get(member.id)!.weekday === 'Mon'
        ) {
          adminSummary ??= await getAdminSummary(org.id, { now });
          const line = adminWeeklyLine(adminSummary);
          if (line) knowledgeLines.push(line);
        }
      }

      const digest = composeDigest({ orgName: org.name, activity, knowledgeLines });
      if (!digest) continue;

      // (1) In-app first. notify() is best-effort and never throws.
      await notificationService.notify({
        orgId: org.id,
        userId: member.id,
        type: 'digest',
        title: digest.title,
        body: digest.body ?? undefined,
        entityType: digest.entityType,
        entityId: org.id,
        createdAt: now,
      });
      result.delivered += 1;
      if (knowledgeLines.length > 0) result.knowledgeItems += 1;

      // (2) Email, per the person's switches. Never breaks the run.
      const emailKnowledge = p?.knowledgeEmail ? knowledgeLines : [];
      if (emailReady && member.email && (activity || emailKnowledge.length > 0)) {
        const emailDigest = composeDigest({
          orgName: org.name,
          activity,
          knowledgeLines: emailKnowledge,
        })!;
        const link = env.WEB_URL
          ? emailKnowledge.length > 0
            ? `${env.WEB_URL}/#/review`
            : `${env.WEB_URL}/activity`
          : '';
        const main = activity
          ? (emailDigest.body ?? '')
          : [emailDigest.title, emailDigest.body].filter(Boolean).join('\n');
        const text = [main, link ? `Open Hearth: ${link}` : ''].filter(Boolean).join('\n\n');
        const bodyHtml = escapeHtml(emailDigest.body ?? '').replace(/\n/g, '<br/>');
        try {
          await emailService.sendEmail({
            to: member.email,
            subject: emailDigest.title,
            text,
            html: `<h2>${escapeHtml(emailDigest.title)}</h2>${bodyHtml ? `<p>${bodyHtml}</p>` : ''}${
              link ? `<p><a href="${escapeHtml(link)}">Open Hearth</a></p>` : ''
            }<br/><small><em>Powered by Hearth</em></small>`,
          });
          result.emailed += 1;
        } catch (err) {
          logger.error({ errName: (err as Error)?.name, userId: member.id }, 'Digest email failed');
        }
      }
    }

    result.reminded = await markReminded(Array.from(reminderIds), now);
    logger.info(
      {
        orgId: org.id,
        delivered: result.delivered,
        knowledgeItems: result.knowledgeItems,
        reminded: result.reminded,
        emailed: result.emailed,
      },
      'Daily digest delivered',
    );
    results.push(result);
  }
  return results;
}
