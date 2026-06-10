// @vitest-environment node
// (vitest.config.ts asks for jsdom, but the jsdom package is not installed in
// this workspace. The api client only touches `document.cookie`, so we run in
// the node environment and stub a minimal `document`.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '../api-client';

// The module computes BASE_URL at import time from import.meta.env;
// in tests VITE_API_BASE_URL is unset, so it falls back to '/api/v1'.
const BASE = '/api/v1';

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function jsonResponse(status: number, body?: unknown): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json:
      body === undefined
        ? () => Promise.reject(new SyntaxError('Unexpected end of JSON input'))
        : () => Promise.resolve(body),
  };
}

// Minimal document stub — the client only reads document.cookie.
const documentStub = { cookie: '' };

function setCsrfCookie(value: string) {
  documentStub.cookie = `hearth.csrf=${value}`;
}

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    documentStub.cookie = '';
    vi.stubGlobal('document', documentStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastFetchInit(): RequestInit {
    return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit;
  }

  function lastFetchHeaders(): Record<string, string> {
    return lastFetchInit().headers as Record<string, string>;
  }

  describe('URL and base behaviour', () => {
    it('prefixes paths with the API base URL', async () => {
      await api.get('/tasks');
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/tasks`, expect.any(Object));
    });

    it('always sends credentials: include for cookie sessions', async () => {
      await api.get('/me');
      expect(lastFetchInit().credentials).toBe('include');
    });

    it('always sets Content-Type: application/json', async () => {
      await api.post('/things', { a: 1 });
      expect(lastFetchHeaders()['Content-Type']).toBe('application/json');
    });
  });

  describe('CSRF token handling', () => {
    it('attaches x-csrf-token from the hearth.csrf cookie on POST', async () => {
      setCsrfCookie('tok-123');
      await api.post('/tasks', { title: 'x' });
      expect(lastFetchHeaders()['x-csrf-token']).toBe('tok-123');
    });

    it.each(['put', 'patch', 'delete'] as const)('attaches x-csrf-token on %s', async (method) => {
      setCsrfCookie('tok-abc');
      await api[method]('/tasks/1', method === 'delete' ? undefined : {});
      expect(lastFetchHeaders()['x-csrf-token']).toBe('tok-abc');
    });

    it('does NOT attach x-csrf-token on GET even when the cookie exists', async () => {
      setCsrfCookie('tok-get');
      await api.get('/tasks');
      expect(lastFetchHeaders()['x-csrf-token']).toBeUndefined();
    });

    it('omits the header when no hearth.csrf cookie is present', async () => {
      await api.post('/tasks', {});
      expect(lastFetchHeaders()['x-csrf-token']).toBeUndefined();
    });

    it('finds the token when hearth.csrf sits among other cookies', async () => {
      documentStub.cookie = 'theme=dark; hearth.csrf=middle-token; locale=en';
      await api.post('/tasks', {});
      expect(lastFetchHeaders()['x-csrf-token']).toBe('middle-token');
    });

    it('URL-decodes the cookie value', async () => {
      // encodeURIComponent('a==b') === 'a%3D%3Db'
      documentStub.cookie = `hearth.csrf=${encodeURIComponent('a==b')}`;
      await api.post('/tasks', {});
      expect(lastFetchHeaders()['x-csrf-token']).toBe('a==b');
    });

    it('does not match cookies whose name merely ends with hearth.csrf', async () => {
      documentStub.cookie = 'nothearth.csrf=evil';
      await api.post('/tasks', {});
      expect(lastFetchHeaders()['x-csrf-token']).toBeUndefined();
    });
  });

  describe('request bodies', () => {
    it('JSON-serializes the body on POST', async () => {
      await api.post('/tasks', { title: 'hello', n: 2 });
      expect(lastFetchInit().method).toBe('POST');
      expect(lastFetchInit().body).toBe(JSON.stringify({ title: 'hello', n: 2 }));
    });

    it('sends no body when POST is called without one', async () => {
      await api.post('/tasks/1/archive');
      expect(lastFetchInit().body).toBeUndefined();
    });

    it('uses the right HTTP verb for each method helper', async () => {
      await api.get('/a');
      expect(lastFetchInit().method).toBe('GET');
      await api.put('/a', {});
      expect(lastFetchInit().method).toBe('PUT');
      await api.patch('/a', {});
      expect(lastFetchInit().method).toBe('PATCH');
      await api.delete('/a');
      expect(lastFetchInit().method).toBe('DELETE');
    });
  });

  describe('response handling', () => {
    it('returns parsed JSON on success', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: '1' } }));
      const result = await api.get<{ data: { id: string } }>('/tasks/1');
      expect(result).toEqual({ data: { id: '1' } });
    });

    it('returns undefined for 204 No Content without calling json()', async () => {
      const json = vi.fn();
      fetchMock.mockResolvedValue({ ok: true, status: 204, json });
      const result = await api.delete('/tasks/1');
      expect(result).toBeUndefined();
      expect(json).not.toHaveBeenCalled();
    });
  });

  describe('error handling (ApiError)', () => {
    async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
      try {
        await promise;
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        return e as ApiError;
      }
      throw new Error('expected request to reject');
    }

    it('throws ApiError carrying status and the server "error" field', async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Forbidden by policy' }));
      const err = await expectApiError(api.get('/admin'));
      expect(err.name).toBe('ApiError');
      expect(err.status).toBe(403);
      expect(err.message).toBe('Forbidden by policy');
    });

    it('falls back to the server "message" field when "error" is absent', async () => {
      fetchMock.mockResolvedValue(jsonResponse(422, { message: 'Validation failed' }));
      const err = await expectApiError(api.post('/tasks', {}));
      expect(err.status).toBe(422);
      expect(err.message).toBe('Validation failed');
    });

    it('prefers "error" over "message" when both are present', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { error: 'primary', message: 'secondary' }));
      const err = await expectApiError(api.post('/tasks', {}));
      expect(err.message).toBe('primary');
    });

    it('uses a generic status message when the error body is not JSON', async () => {
      fetchMock.mockResolvedValue(jsonResponse(500 /* no body -> json() rejects */));
      const err = await expectApiError(api.get('/boom'));
      expect(err.status).toBe(500);
      expect(err.message).toBe('Request failed with status 500');
    });

    it('uses the generic message when the JSON body has neither error nor message', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { data: null }));
      const err = await expectApiError(api.get('/missing'));
      expect(err.message).toBe('Request failed with status 404');
    });

    it('propagates network failures from fetch as-is', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(api.get('/down')).rejects.toThrow('Failed to fetch');
    });
  });
});
