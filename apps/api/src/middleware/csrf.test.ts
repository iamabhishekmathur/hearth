import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction } from 'express';
import { csrfProtection, setCsrfCookie } from './csrf.js';

function makeMockReq(overrides: Record<string, unknown> = {}) {
  const req = {
    method: 'GET',
    originalUrl: '/api/v1/something',
    cookies: {},
    headers: {},
    ...overrides,
  } as any;
  // Backwards compat: if test passes `path`, use it as originalUrl
  if (overrides.path && !overrides.originalUrl) {
    req.originalUrl = overrides.path;
  }
  return req;
}

function makeMockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    cookie: vi.fn(),
  } as any;
}

describe('csrfProtection', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn() as unknown as NextFunction;
  });

  it('passes through GET requests without CSRF check', () => {
    const req = makeMockReq({ method: 'GET' });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through HEAD requests without CSRF check', () => {
    const req = makeMockReq({ method: 'HEAD' });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('rejects POST request without CSRF token with 403', () => {
    const req = makeMockReq({ method: 'POST' });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF token missing' });
  });

  it('passes POST request with matching CSRF cookie and header', () => {
    const token = 'valid-token-123';
    const req = makeMockReq({
      method: 'POST',
      cookies: { 'hearth.csrf': token },
      headers: { 'x-csrf-token': token },
    });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects POST request with mismatching CSRF tokens', () => {
    const req = makeMockReq({
      method: 'POST',
      cookies: { 'hearth.csrf': 'cookie-token' },
      headers: { 'x-csrf-token': 'header-token' },
    });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF token mismatch' });
  });

  it('rejects PUT request without CSRF token', () => {
    const req = makeMockReq({ method: 'PUT' });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects DELETE request without CSRF token', () => {
    const req = makeMockReq({ method: 'DELETE' });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('exempts login path from CSRF check', () => {
    const req = makeMockReq({
      method: 'POST',
      path: '/api/v1/auth/login',
    });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('exempts register path from CSRF check', () => {
    const req = makeMockReq({
      method: 'POST',
      path: '/api/v1/auth/register',
    });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects POST with cookie but no header', () => {
    const req = makeMockReq({
      method: 'POST',
      cookies: { 'hearth.csrf': 'some-token' },
      headers: {},
    });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects POST with header but no cookie', () => {
    const req = makeMockReq({
      method: 'POST',
      cookies: {},
      headers: { 'x-csrf-token': 'some-token' },
    });
    const res = makeMockRes();

    csrfProtection(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('setCsrfCookie', () => {
  it('sets a cookie on the response and returns the token', () => {
    const res = makeMockRes();

    const token = setCsrfCookie(res, true);

    expect(typeof token).toBe('string');
    expect(token.length).toBe(64); // 32 bytes hex = 64 chars
    expect(res.cookie).toHaveBeenCalledWith('hearth.csrf', token, {
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it('sets secure: false when isSecure is false', () => {
    const res = makeMockRes();

    setCsrfCookie(res, false);

    expect(res.cookie).toHaveBeenCalledWith(
      'hearth.csrf',
      expect.any(String),
      expect.objectContaining({ secure: false }),
    );
  });

  it('returns a different token each time', () => {
    const res = makeMockRes();
    const token1 = setCsrfCookie(res, true);
    const token2 = setCsrfCookie(res, true);

    expect(token1).not.toBe(token2);
  });
});
