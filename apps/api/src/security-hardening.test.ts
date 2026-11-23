import { describe, it, expect } from 'vitest';
import { productionSecretProblems } from './config.js';
import { isTrustedSsoCaller } from './routes/auth.js';
import { isValidOAuthState } from './routes/auth-slack-oauth.js';

describe('productionSecretProblems', () => {
  const strongKey = 'a1'.repeat(32);
  const strongSecret = 'b'.repeat(48);

  it('allows dev defaults outside production', () => {
    expect(
      productionSecretProblems({
        NODE_ENV: 'development',
        ENCRYPTION_KEY: '0'.repeat(64),
        SESSION_SECRET: 'dev-session-secret',
      }),
    ).toEqual([]);
  });

  it('rejects the all-zero ENCRYPTION_KEY in production', () => {
    const p = productionSecretProblems({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: '0'.repeat(64),
      SESSION_SECRET: strongSecret,
    });
    expect(p.join()).toMatch(/all-zero/);
  });

  it('rejects a non-hex / wrong-length ENCRYPTION_KEY in production', () => {
    const p = productionSecretProblems({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'change-me-to-a-32-byte-hex-string',
      SESSION_SECRET: strongSecret,
    });
    expect(p.join()).toMatch(/64 hex/);
  });

  it('rejects the default or short SESSION_SECRET in production', () => {
    expect(
      productionSecretProblems({
        NODE_ENV: 'production',
        ENCRYPTION_KEY: strongKey,
        SESSION_SECRET: 'dev-session-secret',
      }),
    ).toHaveLength(1);
    expect(
      productionSecretProblems({
        NODE_ENV: 'production',
        ENCRYPTION_KEY: strongKey,
        SESSION_SECRET: 'short',
      }),
    ).toHaveLength(1);
  });

  it('accepts strong secrets in production', () => {
    expect(
      productionSecretProblems({
        NODE_ENV: 'production',
        ENCRYPTION_KEY: strongKey,
        SESSION_SECRET: strongSecret,
      }),
    ).toEqual([]);
  });
});

describe('isTrustedSsoCaller (SSO callback gate)', () => {
  const secret = 's'.repeat(40);
  it('rejects every caller when no secret is configured', () => {
    expect(isTrustedSsoCaller(secret, undefined)).toBe(false);
  });
  it('rejects missing, wrong or different-length secrets', () => {
    expect(isTrustedSsoCaller(undefined, secret)).toBe(false);
    expect(isTrustedSsoCaller('x'.repeat(40), secret)).toBe(false);
    expect(isTrustedSsoCaller('s', secret)).toBe(false);
  });
  it('accepts the configured verifier secret', () => {
    expect(isTrustedSsoCaller(secret, secret)).toBe(true);
  });
});

describe('isValidOAuthState (Slack OAuth CSRF)', () => {
  it('requires a matching state bound to the session', () => {
    expect(isValidOAuthState('abc', undefined)).toBe(false);
    expect(isValidOAuthState(undefined, 'abc')).toBe(false);
    expect(isValidOAuthState('abd', 'abc')).toBe(false);
    expect(isValidOAuthState('abc', 'abc')).toBe(true);
  });
});
