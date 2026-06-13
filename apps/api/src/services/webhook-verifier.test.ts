import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

// ── Mocks ──
// decrypt is mocked to return the secret verbatim so the tests can compute the
// expected HMAC with a known key.

vi.mock('../mcp/token-store.js', () => ({
  decrypt: vi.fn((s: string) => s),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { verifyWebhookSignature } from './webhook-verifier.js';

const SECRET = 'webhook-secret';
const BODY = '{"event":"push","ref":"main"}';

function githubSig(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function slackSig(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
}

function genericSig(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GitHub (TRIG-H-03, TRIG-E-01) ──

describe('GitHub signature verification', () => {
  it('accepts a valid HMAC signature (TRIG-H-03)', () => {
    const headers = { 'x-hub-signature-256': githubSig(SECRET, BODY) };
    expect(verifyWebhookSignature('github', SECRET, headers, BODY)).toBe(true);
  });

  it('rejects a bad HMAC signature (TRIG-E-01)', () => {
    const headers = { 'x-hub-signature-256': githubSig(SECRET, 'tampered body') };
    expect(verifyWebhookSignature('github', SECRET, headers, BODY)).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    expect(verifyWebhookSignature('github', SECRET, {}, BODY)).toBe(false);
  });

  it('rejects a length-mismatched signature without throwing', () => {
    const headers = { 'x-hub-signature-256': 'sha256=short' };
    expect(verifyWebhookSignature('github', SECRET, headers, BODY)).toBe(false);
  });

  it('rejects when signed with the wrong secret', () => {
    const headers = { 'x-hub-signature-256': githubSig('other-secret', BODY) };
    expect(verifyWebhookSignature('github', SECRET, headers, BODY)).toBe(false);
  });
});

// ── Slack ──

describe('Slack signature verification', () => {
  const TS = '1718000000';

  it('accepts a valid v0 signature', () => {
    const headers = {
      'x-slack-request-timestamp': TS,
      'x-slack-signature': slackSig(SECRET, TS, BODY),
    };
    expect(verifyWebhookSignature('slack', SECRET, headers, BODY)).toBe(true);
  });

  it('rejects when timestamp is missing', () => {
    const headers = { 'x-slack-signature': slackSig(SECRET, TS, BODY) };
    expect(verifyWebhookSignature('slack', SECRET, headers, BODY)).toBe(false);
  });

  it('rejects when signature is missing', () => {
    const headers = { 'x-slack-request-timestamp': TS };
    expect(verifyWebhookSignature('slack', SECRET, headers, BODY)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const headers = {
      'x-slack-request-timestamp': TS,
      'x-slack-signature': slackSig(SECRET, TS, 'evil'),
    };
    expect(verifyWebhookSignature('slack', SECRET, headers, BODY)).toBe(false);
  });
});

// ── Notion / Jira (TRIG-E-02 fixed: require a signature, fail closed) ──

describe('Notion / Jira signature verification (URL-token trust)', () => {
  // Posture: Jira/Notion don't send a body HMAC; auth is the unguessable urlToken
  // in the ingest URL (the ingest route 404s an unknown/disabled token). Generic
  // providers, by contrast, MUST sign (see below).
  it('Jira and Notion accept payloads (auth is the URL token, not a body HMAC)', () => {
    expect(verifyWebhookSignature('notion', SECRET, {}, BODY)).toBe(true);
    expect(verifyWebhookSignature('jira', SECRET, {}, BODY)).toBe(true);
  });
});

// ── Unknown / generic provider ──

describe('Generic HMAC verification for unknown providers', () => {
  it('accepts a valid x-webhook-signature HMAC', () => {
    const headers = { 'x-webhook-signature': genericSig(SECRET, BODY) };
    expect(verifyWebhookSignature('custom', SECRET, headers, BODY)).toBe(true);
  });

  it('accepts a valid x-signature HMAC', () => {
    const headers = { 'x-signature': genericSig(SECRET, BODY) };
    expect(verifyWebhookSignature('custom', SECRET, headers, BODY)).toBe(true);
  });

  it('rejects a bad generic HMAC', () => {
    const headers = { 'x-webhook-signature': genericSig('wrong', BODY) };
    expect(verifyWebhookSignature('custom', SECRET, headers, BODY)).toBe(false);
  });

  it('rejects an unsigned payload (fail closed — no signature is not authenticated)', () => {
    expect(verifyWebhookSignature('custom', SECRET, {}, BODY)).toBe(false);
  });
});
