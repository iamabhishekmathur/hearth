import { describe, it, expect } from 'vitest';
import { verifySlackSignature } from './slack-service.js';
import crypto from 'node:crypto';

describe('slack-service', () => {
  describe('verifySlackSignature', () => {
    const signingSecret = 'test-signing-secret';

    function createSignature(timestamp: string, body: string): string {
      const sigBasestring = `v0:${timestamp}:${body}`;
      return 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');
    }

    it('verifies a valid signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = '{"type":"url_verification"}';
      const signature = createSignature(timestamp, body);

      expect(verifySlackSignature(signingSecret, timestamp, body, signature)).toBe(true);
    });

    it('rejects an invalid signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = '{"type":"url_verification"}';
      // Use a valid-length hex string but wrong value
      const wrongSecret = 'wrong-signing-secret';
      const sigBasestring = `v0:${timestamp}:${body}`;
      const wrongSignature =
        'v0=' + crypto.createHmac('sha256', wrongSecret).update(sigBasestring).digest('hex');

      expect(verifySlackSignature(signingSecret, timestamp, body, wrongSignature)).toBe(false);
    });

    it('rejects old timestamps (replay attack)', () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
      const body = '{"type":"url_verification"}';
      const signature = createSignature(oldTimestamp, body);

      expect(verifySlackSignature(signingSecret, oldTimestamp, body, signature)).toBe(false);
    });
  });
});
