import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger to avoid noise
vi.mock('../lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { errorHandler } from './error-handler.js';

function makeMockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;
}

const mockReq = {} as any;
const mockNext = vi.fn();

describe('errorHandler', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns status from err.status', () => {
    const res = makeMockRes();
    const err = { status: 404, message: 'Not found' } as any;

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns status from err.statusCode', () => {
    const res = makeMockRes();
    const err = { statusCode: 422, message: 'Unprocessable' } as any;

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns 500 for errors without status', () => {
    const res = makeMockRes();
    const err = { message: 'Something broke' } as any;

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('shows error message in non-production', () => {
    process.env.NODE_ENV = 'development';
    const res = makeMockRes();
    const err = { status: 400, message: 'Bad request body' } as any;

    errorHandler(err, mockReq, res, mockNext);

    expect(res.json).toHaveBeenCalledWith({ error: 'Bad request body' });
  });

  it('hides error message in production', () => {
    process.env.NODE_ENV = 'production';
    const res = makeMockRes();
    const err = { status: 500, message: 'secret database error details' } as any;

    errorHandler(err, mockReq, res, mockNext);

    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('uses "Unknown error" when err.message is missing in non-production', () => {
    process.env.NODE_ENV = 'test';
    const res = makeMockRes();
    const err = { status: 500 } as any;

    errorHandler(err, mockReq, res, mockNext);

    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown error' });
  });

  it('prefers err.status over err.statusCode', () => {
    const res = makeMockRes();
    const err = { status: 401, statusCode: 403, message: 'test' } as any;

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
