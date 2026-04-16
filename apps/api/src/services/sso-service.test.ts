import { describe, it, expect } from 'vitest';
import { validateSAMLConfig, validateOIDCConfig } from './sso-service.js';

describe('SSO config validation', () => {
  describe('SAML', () => {
    it('returns no errors for valid config', () => {
      const errors = validateSAMLConfig({
        entryPoint: 'https://idp.example.com/sso',
        issuer: 'hearth',
        cert: 'MIID...',
      });
      expect(errors).toHaveLength(0);
    });

    it('returns error for missing entryPoint', () => {
      const errors = validateSAMLConfig({ issuer: 'hearth', cert: 'x' });
      expect(errors).toContain('entryPoint is required for SAML');
    });

    it('returns error for missing issuer', () => {
      const errors = validateSAMLConfig({ entryPoint: 'x', cert: 'x' });
      expect(errors).toContain('issuer is required for SAML');
    });

    it('returns error for missing cert', () => {
      const errors = validateSAMLConfig({ entryPoint: 'x', issuer: 'x' });
      expect(errors).toContain('cert is required for SAML');
    });

    it('returns all errors for empty config', () => {
      const errors = validateSAMLConfig({});
      expect(errors).toHaveLength(3);
    });
  });

  describe('OIDC', () => {
    it('returns no errors for valid config', () => {
      const errors = validateOIDCConfig({
        discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        clientId: 'client-123',
        clientSecret: 'secret',
      });
      expect(errors).toHaveLength(0);
    });

    it('returns error for missing discoveryUrl', () => {
      const errors = validateOIDCConfig({ clientId: 'x', clientSecret: 'x' });
      expect(errors).toContain('discoveryUrl is required for OIDC');
    });

    it('returns error for missing clientId', () => {
      const errors = validateOIDCConfig({ discoveryUrl: 'x', clientSecret: 'x' });
      expect(errors).toContain('clientId is required for OIDC');
    });

    it('returns error for missing clientSecret', () => {
      const errors = validateOIDCConfig({ discoveryUrl: 'x', clientId: 'x' });
      expect(errors).toContain('clientSecret is required for OIDC');
    });

    it('returns all errors for empty config', () => {
      const errors = validateOIDCConfig({});
      expect(errors).toHaveLength(3);
    });
  });
});

describe('SSO callback input validation', () => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const slugRegex = /^[a-z0-9-]+$/;

  function validateSSOInput(input: { email?: string; name?: string; orgSlug?: string }): string[] {
    const errors: string[] = [];
    if (!input.email || !input.name || !input.orgSlug) {
      errors.push('All fields required');
      return errors;
    }
    if (!emailRegex.test(input.email) || input.email.length > 254) {
      errors.push('Invalid email format');
    }
    if (input.name.length > 200) {
      errors.push('Name too long');
    }
    if (!slugRegex.test(input.orgSlug) || input.orgSlug.length > 100) {
      errors.push('Invalid organization slug');
    }
    return errors;
  }

  it('accepts valid input', () => {
    expect(validateSSOInput({ email: 'user@example.com', name: 'Alice', orgSlug: 'my-org' })).toHaveLength(0);
  });

  it('rejects missing fields', () => {
    expect(validateSSOInput({})).toContain('All fields required');
    expect(validateSSOInput({ email: 'a@b.com' })).toContain('All fields required');
  });

  it('rejects invalid email', () => {
    expect(validateSSOInput({ email: 'not-an-email', name: 'A', orgSlug: 'org' })).toContain('Invalid email format');
    expect(validateSSOInput({ email: 'no@dots', name: 'A', orgSlug: 'org' })).toContain('Invalid email format');
  });

  it('rejects email over 254 chars', () => {
    const longEmail = 'a'.repeat(243) + '@example.com'; // 255 chars
    expect(validateSSOInput({ email: longEmail, name: 'A', orgSlug: 'org' })).toContain('Invalid email format');
  });

  it('rejects name over 200 chars', () => {
    expect(validateSSOInput({ email: 'a@b.com', name: 'x'.repeat(201), orgSlug: 'org' })).toContain('Name too long');
  });

  it('rejects invalid slug', () => {
    expect(validateSSOInput({ email: 'a@b.com', name: 'A', orgSlug: 'My Org!' })).toContain('Invalid organization slug');
    expect(validateSSOInput({ email: 'a@b.com', name: 'A', orgSlug: 'UPPER' })).toContain('Invalid organization slug');
  });

  it('rejects slug over 100 chars', () => {
    expect(validateSSOInput({ email: 'a@b.com', name: 'A', orgSlug: 'a'.repeat(101) })).toContain('Invalid organization slug');
  });
});
