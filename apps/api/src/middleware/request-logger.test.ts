import { describe, it, expect } from 'vitest';
import { redactUrl } from './request-logger.js';

describe('redactUrl', () => {
  it('redacts the OAuth code and state on the ChatGPT callback', () => {
    const out = redactUrl(
      '/api/v1/auth/chatgpt/callback?code=ac.1.SECRET&scope=openid+email&state=abc123&client_id=oaiapp_x',
    )!;
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('abc123');
    expect(out).toContain('client_id=oaiapp_x');
    expect(out).toContain('scope=openid+email');
  });

  it('leaves URLs without sensitive params untouched', () => {
    expect(redactUrl('/api/v1/tasks?status=open&limit=20')).toBe('/api/v1/tasks?status=open&limit=20');
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
  });

  it('matches parameter names case-insensitively', () => {
    expect(redactUrl('/x?Token=abc')).toBe('/x?Token=%5BREDACTED%5D');
  });
});
