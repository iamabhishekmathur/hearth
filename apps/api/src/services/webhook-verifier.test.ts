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

// ── Notion / Jira (TRIG-E-02 defect) ──

describe('Notion / Jira signature verification', () => {
  it('DEFECT (TRIG-E-02): Notion always returns true — accepts unsigned (pins current behavior)', () => {
    // DEFECT (TRIG-E-02): Notion has no signature verification — verifyWebhookSignature
    // returns true unconditionally, accepting unsigned/forged payloads. When real
    // verification is added this should flip and require a valid signature.
    expect(verifyWebhookSignature('notion', SECRET, {}, BODY)).toBe(true);
    expect(verifyWebhookSignature('notion', SECRET, { 'x-evil': 'forged' }, 'anything')).toBe(true);
  });

  it('DEFECT (TRIG-E-02): Jira always returns true — accepts unsigned (pins current behavior)', () => {
    // DEFECT (TRIG-E-02): Jira verification is a no-op (relies on URL token presence),
    // so verifyWebhookSignature returns true for any payload regardless of headers.
    expect(verifyWebhookSignature('jira', SECRET, {}, BODY)).toBe(true);
    expect(verifyWebhookSignature('jira', SECRET, { 'x-evil': 'forged' }, 'anything')).toBe(true);
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

  it('returns true when no signature header is present (no verification expected)', () => {
    // Pins current behavior: unknown provider with no signature header is treated
    // as "no verification expected" and passes.
    expect(verifyWebhookSignature('custom', SECRET, {}, BODY)).toBe(true);
  });
});
