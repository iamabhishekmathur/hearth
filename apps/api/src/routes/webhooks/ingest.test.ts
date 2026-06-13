import { describe, it, expect } from 'vitest';
import { extractMessageSignal } from './ingest.js';

// extractMessageSignal turns a raw provider webhook payload into a normalized
// work signal (text + author + thread) that feeds detectAndCreateTask. These
// tests pin the EMAIL connector (intake from forwarded email) alongside the
// existing slack behavior — no LLM, no DB, pure mapping.

describe('extractMessageSignal — email intake', () => {
  it('maps a plain-text email (subject + body) to an email signal', () => {
    const sig = extractMessageSignal('email', {
      from: 'Alice Chen <alice@acme.com>',
      to: 'intake@hearth.acme.com',
      subject: 'Please refresh the SOC2 evidence doc',
      text: 'The auditors need the updated access-review export by Friday.',
      messageId: '<msg-1@acme.com>',
    });
    expect(sig).not.toBeNull();
    expect(sig!.source).toBe('email');
    // subject + body are joined so the one-line ask is preserved
    expect(sig!.text).toContain('Please refresh the SOC2 evidence doc');
    expect(sig!.text).toContain('access-review export');
    // From header is reduced to the bare, lowercased address
    expect(sig!.from).toBe('alice@acme.com');
    expect(sig!.fromHandle).toEqual({ provider: 'email', externalId: 'alice@acme.com' });
    expect(sig!.messageId).toBe('<msg-1@acme.com>');
    // A first-message thread roots on its own id
    expect(sig!.threadRef).toEqual({ provider: 'email', externalId: '<msg-1@acme.com>' });
  });

  it('threads a reply onto the conversation root via References', () => {
    const sig = extractMessageSignal('email', {
      from: 'bob@acme.com',
      subject: 'Re: Please refresh the SOC2 evidence doc',
      text: 'On it — will have it by Thursday.',
      messageId: '<msg-2@acme.com>',
      references: '<msg-root@acme.com> <msg-1@acme.com>',
      inReplyTo: '<msg-1@acme.com>',
    });
    // The first id in References is the conversation root
    expect(sig!.threadRef).toEqual({ provider: 'email', externalId: '<msg-root@acme.com>' });
  });

  it('falls back to In-Reply-To when there is no References header', () => {
    const sig = extractMessageSignal('email', {
      from: 'bob@acme.com',
      subject: 'Re: thing',
      text: 'reply body that is long enough',
      messageId: '<msg-3@acme.com>',
      inReplyTo: '<msg-1@acme.com>',
    });
    expect(sig!.threadRef!.externalId).toBe('<msg-1@acme.com>');
  });

  it('strips HTML when only an HTML body is present', () => {
    const sig = extractMessageSignal('email', {
      from: 'carol@acme.com',
      subject: 'Quarterly numbers',
      html: '<html><body><p>Please <b>update</b> the Q3 deck.</p><style>.x{color:red}</style></body></html>',
      messageId: '<msg-4@acme.com>',
    });
    expect(sig!.text).toContain('Please update the Q3 deck.');
    expect(sig!.text).not.toContain('<');
    expect(sig!.text).not.toContain('color:red');
  });

  it('tolerates capitalized header variants (Postmark/SendGrid shapes)', () => {
    const sig = extractMessageSignal('email', {
      From: 'dave@acme.com',
      Subject: 'Migrate the analytics pipeline',
      TextBody: 'We should move the analytics jobs to the new cluster.',
      MessageID: '<msg-5@acme.com>',
    });
    expect(sig).not.toBeNull();
    expect(sig!.from).toBe('dave@acme.com');
    expect(sig!.text).toContain('Migrate the analytics pipeline');
  });

  it('returns null when there is no sender', () => {
    expect(
      extractMessageSignal('email', { subject: 'orphan', text: 'no from header here' }),
    ).toBeNull();
  });

  it('returns null when there is no usable text', () => {
    expect(extractMessageSignal('email', { from: 'a@acme.com' })).toBeNull();
  });
});

describe('extractMessageSignal — slack (unchanged)', () => {
  it('maps a slack message event', () => {
    const sig = extractMessageSignal('slack', {
      event: {
        type: 'message',
        text: 'Can you review the auth refactor PR?',
        user: 'U123',
        ts: '1718000000.0001',
        channel: 'C999',
      },
    });
    expect(sig!.source).toBe('slack');
    expect(sig!.from).toBe('U123');
    expect(sig!.fromHandle).toEqual({ provider: 'slack', externalId: 'U123' });
  });

  it('ignores bot messages', () => {
    const sig = extractMessageSignal('slack', {
      event: { type: 'message', text: 'beep boop', bot_id: 'B1' },
    });
    expect(sig).toBeNull();
  });

  it('returns null for an unknown provider', () => {
    expect(extractMessageSignal('github', { action: 'opened' })).toBeNull();
  });
});
