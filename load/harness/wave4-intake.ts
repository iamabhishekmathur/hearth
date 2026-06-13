/**
 * WAVE 4 — Task intake / detection. Push is SIMULATED, detection is REAL.
 *
 *   - Slack: POST a properly-signed Slack message event to the ingest webhook;
 *     Hearth's detector classifies it and (if actionable) creates an auto_detected task.
 *   - Non-actionable filter ("thanks!") → no task.
 *   - Forged webhook (jira) accepted unsigned → signature-bypass defect.
 *   - Email intake → no-op stub (gap).
 *   - Granola/meeting ingest → DECISIONS extracted, NOT tasks.
 */
import { createHmac } from 'node:crypto';
import { loginAs, prisma, sleep, API } from './core.js';
import { Recorder } from './core.js';

const F = 'Intake & Detection';

function slackSign(secret: string, body: string): { sig: string; ts: string } {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  return { sig, ts };
}

async function postIngest(urlToken: string, provider: string, body: string, secret?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider === 'slack' && secret) {
    const { sig, ts } = slackSign(secret, body);
    headers['x-slack-signature'] = sig;
    headers['x-slack-request-timestamp'] = ts;
  }
  return fetch(`${API}/webhooks/ingest/${urlToken}`, { method: 'POST', headers, body });
}

async function main() {
  const rec = new Recorder('wave4-intake');
  const orgId = (await prisma.org.findUniqueOrThrow({ where: { slug: 'hearth-sim' } })).id;
  const admin = await loginAs('it-admin@hearth.local'); // creates webhook endpoints

  // ── Setup: a Slack webhook endpoint ───────────────────────────────────────
  const ep = await admin.req<{ data?: { urlToken: string; plainSecret: string } }>('POST', '/routines/webhook-endpoints', { provider: 'slack' });
  const slackToken = ep.body.data?.urlToken!;
  const slackSecret = ep.body.data?.plainSecret!;
  rec.record({ feature: F, subFeature: 'setup', type: 'happy', name: 'Create a Slack ingest webhook endpoint',
    expected: '200 + urlToken + secret', observed: `status ${ep.status}, token=${slackToken ? 'yes' : 'no'}`, status: slackToken ? 'pass' : 'fail' });

  // ── Slack push → real detection ───────────────────────────────────────────
  console.log('\n══ Slack detection ══');
  {
    const baseTasks = await prisma.task.count({ where: { source: 'slack', org: { slug: 'hearth-sim' } } });
    // Unique ref so the LLM-derived task title differs per run (else intake
    // dedup by title swallows the re-detected task on repeat runs).
    const slackTag = Math.floor(Date.now() / 1000) % 100000;
    const body = JSON.stringify({ event: { type: 'message', text: `Can someone add rate limiting to the public API endpoint /v2/orders-${slackTag} before the launch on Friday? It is getting hammered.`, user: 'U07ALICE', ts: `${Date.now() / 1000}`, channel: 'C_ENGINEERING', client_msg_id: `m-${Date.now()}` } });
    const r = await postIngest(slackToken, 'slack', body, slackSecret);
    // detection is async; poll for a new slack-sourced auto_detected task
    let created = 0;
    for (let i = 0; i < 24; i++) {
      await sleep(2500);
      created = (await prisma.task.count({ where: { source: 'slack', status: 'auto_detected', org: { slug: 'hearth-sim' } } })) - baseTasks;
      if (created > 0) break;
    }
    rec.record({ feature: F, subFeature: 'slack detection', type: 'happy', name: 'Signed actionable Slack message → auto-detected task',
      expected: '200 ack; Hearth detects + creates an auto_detected task', observed: `ack ${r.status}; new tasks=${created}`,
      status: r.status === 200 && created > 0 ? 'pass' : r.status === 200 ? 'partial' : 'fail',
      defects: r.status === 200 && created === 0 ? ['Signed actionable Slack message did not produce an auto_detected task within timeout'] : (r.status !== 200 ? [`Slack ingest rejected the signed payload (status ${r.status}) — signature/verify path`] : undefined) });
  }

  // ── Non-actionable filtered out ───────────────────────────────────────────
  {
    const base = await prisma.task.count({ where: { source: 'slack', org: { slug: 'hearth-sim' } } });
    const body = JSON.stringify({ event: { type: 'message', text: 'thanks!', user: 'U07BOB', ts: `${Date.now() / 1000}`, channel: 'C_RANDOM', client_msg_id: `m2-${Date.now()}` } });
    const r = await postIngest(slackToken, 'slack', body, slackSecret);
    await sleep(8000);
    const created = (await prisma.task.count({ where: { source: 'slack', org: { slug: 'hearth-sim' } } })) - base;
    rec.record({ feature: F, subFeature: 'non-actionable filter', type: 'happy', name: 'Non-actionable Slack chatter ("thanks!") is ignored',
      expected: 'no task created (pre-filter)', observed: `ack ${r.status}; new tasks=${created}`,
      status: r.status === 200 && created === 0 ? 'pass' : 'partial' });
  }

  // ── Webhook auth posture ──────────────────────────────────────────────────
  // Chosen posture (2026-06-11): Jira/Notion/Email authenticate via the
  // unguessable urlToken (they don't sign bodies); generic/unknown providers
  // MUST present a valid HMAC and fail closed when unsigned.
  console.log('\n══ Security: webhook auth posture ══');
  {
    // Jira: a valid URL token is accepted by design (URL-token trust).
    const jep = await admin.req<{ data?: { urlToken: string } }>('POST', '/routines/webhook-endpoints', { provider: 'jira' });
    const jToken = jep.body.data?.urlToken!;
    const r = await postIngest(jToken, 'jira', JSON.stringify({ issue: { fields: { summary: 'real jira event' } } }));
    rec.record({ feature: F, subFeature: 'webhook auth: jira', type: 'permission', name: 'Jira accepts the unguessable URL token (no body HMAC)',
      expected: 'accepted (200) — auth is the URL token, by design', observed: `status ${r.status}`,
      status: r.status === 200 ? 'pass' : 'fail' });
  }
  {
    // Generic/unknown provider: an unsigned payload must be rejected (fail closed).
    const gep = await admin.req<{ data?: { urlToken: string } }>('POST', '/routines/webhook-endpoints', { provider: 'custom' });
    const gToken = gep.body.data?.urlToken!;
    const r = await postIngest(gToken, 'custom', JSON.stringify({ event: 'forged' })); // NO signature
    rec.record({ feature: F, subFeature: 'webhook auth: generic', type: 'violation', name: 'Unsigned generic webhook is rejected',
      expected: 'rejected (401) — generic providers must sign', observed: `status ${r.status}`,
      status: r.status === 401 ? 'pass' : 'fail',
      defects: r.status === 200 ? ['Generic webhook accepts unsigned payloads — fail-open signature bypass'] : undefined });
  }

  // ── Email intake → real detection ─────────────────────────────────────────
  console.log('\n══ Email detection ══');
  {
    const eep = await admin.req<{ data?: { urlToken: string } }>('POST', '/routines/webhook-endpoints', { provider: 'email' });
    const emailToken = eep.body.data?.urlToken!;
    const base = await prisma.task.count({ where: { source: 'email', org: { slug: 'hearth-sim' } } });
    const emailTag = Math.floor(Date.now() / 1000) % 100000;
    const emailBody = JSON.stringify({
      from: 'Dana Patel <dana.patel@partner-vendor.com>',
      to: 'intake@hearth-sim.com',
      subject: `Please update the SOC2 access-review evidence (case ${emailTag}) before the audit`,
      text: `The auditors flagged that our quarterly access-review export (case ${emailTag}) is stale. Can someone regenerate it and attach it to the evidence folder before Friday?`,
      messageId: `<email-${Date.now()}@partner-vendor.com>`,
    });
    const r = await postIngest(emailToken, 'email', emailBody);
    let created = 0;
    for (let i = 0; i < 24; i++) {
      await sleep(2500);
      created = (await prisma.task.count({ where: { source: 'email', status: 'auto_detected', org: { slug: 'hearth-sim' } } })) - base;
      if (created > 0) break;
    }
    rec.record({ feature: F, subFeature: 'email detection', type: 'happy', name: 'Inbound email (subject+body) → auto-detected task',
      expected: '200 ack; Hearth detects the ask and creates an email-sourced auto_detected task', observed: `ack ${r.status}; new tasks=${created}`,
      status: r.status === 200 && created > 0 ? 'pass' : r.status === 200 ? 'partial' : 'fail',
      defects: r.status === 200 && created === 0 ? ['Actionable inbound email did not produce an auto_detected task within timeout'] : (r.status !== 200 ? [`Email ingest rejected the payload (status ${r.status})`] : undefined) });
  }

  // ── Granola / meeting ingest → decisions (not tasks) ──────────────────────
  console.log('\n══ Granola / meeting ingest ══');
  {
    const cto = await loginAs('cto@hearth.local');
    const baseDec = await prisma.decision.count({ where: { orgId } });
    const baseTask = await prisma.task.count({ where: { source: 'meeting', orgId } });
    // Unique per-run topics so extracted decisions don't dedup-merge into a
    // prior run's identical decisions (which would show as +0 extracted).
    const mtg = Math.floor(Date.now() / 1000) % 100000;
    const transcript = [
      `Marcus: Quick sync. Decision: we standardize on message queue Kafka-${mtg} for all event streaming this quarter.`,
      `Sofia: Agreed. We also decided to cap the deploy freeze window to ${mtg % 12} hours.`,
      `Marcus: And we will sunset the legacy reporting service report-${mtg} by end of next sprint.`,
    ].join('\n');
    const ing = await cto.req('POST', '/meetings/ingest', { provider: 'granola', title: 'Eng leadership sync', transcript, participants: ['cto@hearth.local', 'vp-eng@hearth.local'], meetingDate: new Date().toISOString() });
    let decDelta = 0;
    for (let i = 0; i < 24; i++) { await sleep(2500); decDelta = (await prisma.decision.count({ where: { orgId } })) - baseDec; if (decDelta > 0) break; }
    const taskDelta = (await prisma.task.count({ where: { source: 'meeting', orgId } })) - baseTask;
    rec.record({ feature: F, subFeature: 'granola/meeting', type: 'happy', name: 'Granola transcript ingest → decisions extracted',
      expected: 'meeting ingested; decisions extracted (not tasks)', observed: `ingest ${ing.status}; +${decDelta} decisions; +${taskDelta} meeting-tasks`,
      status: ing.status < 300 && decDelta > 0 ? 'pass' : ing.status < 300 ? 'partial' : 'fail' });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave4 failed:', e); await prisma.$disconnect(); process.exit(1); });
