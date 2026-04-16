import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimit } from './rate-limiter.js';

let ipCounter = 0;

function uniqueIp(): string {
  ipCounter++;
  return `10.0.0.${ipCounter}`;
}

function createMockReq(ip: string) {
  return { ip, socket: { remoteAddress: ip } } as any;
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
  };
  return res;
}

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    const ip = uniqueIp();
    const limiter = rateLimit({ windowMs: 60_000, max: 3 });
    const req = createMockReq(ip);
    const next = vi.fn();

    limiter(req, createMockRes(), next);
    limiter(req, createMockRes(), next);
    limiter(req, createMockRes(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('blocks requests over the limit with 429', () => {
    const ip = uniqueIp();
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    const req = createMockReq(ip);
    const next = vi.fn();

    limiter(req, createMockRes(), next); // 1
    limiter(req, createMockRes(), next); // 2

    const blockedRes = createMockRes();
    limiter(req, blockedRes, next); // 3 → should be blocked

    expect(next).toHaveBeenCalledTimes(2);
    expect(blockedRes.statusCode).toBe(429);
    expect(blockedRes.body).toEqual({ error: 'Too many requests' });
  });

  it('uses custom message when provided', () => {
    const ip = uniqueIp();
    const limiter = rateLimit({ windowMs: 60_000, max: 1, message: 'Slow down!' });
    const req = createMockReq(ip);
    const next = vi.fn();

    limiter(req, createMockRes(), next); // 1

    const blockedRes = createMockRes();
    limiter(req, blockedRes, next); // 2 → blocked

    expect(blockedRes.body).toEqual({ error: 'Slow down!' });
  });

  it('resets after window expires', () => {
    const ip = uniqueIp();
    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    const req = createMockReq(ip);
    const next = vi.fn();

    limiter(req, createMockRes(), next); // 1 → allowed
    expect(next).toHaveBeenCalledTimes(1);

    const blockedRes = createMockRes();
    limiter(req, blockedRes, next); // 2 → blocked
    expect(next).toHaveBeenCalledTimes(1);
    expect(blockedRes.statusCode).toBe(429);

    // Advance time past the window
    vi.advanceTimersByTime(1001);

    limiter(req, createMockRes(), next); // should be allowed again
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('tracks different IPs independently', () => {
    const ip1 = uniqueIp();
    const ip2 = uniqueIp();
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();

    limiter(createMockReq(ip1), createMockRes(), next); // IP 1 → allowed
    limiter(createMockReq(ip2), createMockRes(), next); // IP 2 → allowed
    expect(next).toHaveBeenCalledTimes(2);
  });
});
