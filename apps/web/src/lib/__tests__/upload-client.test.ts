// @vitest-environment node
// (jsdom is configured but not installed; Node 20+ provides File/FormData and
// the upload client only reads document.cookie, which we stub.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadFile } from '../upload-client';

const documentStub = { cookie: '' };

const UPLOAD_RESULT = {
  id: 'up_1',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1234,
  url: '/uploads/up_1',
};

describe('uploadFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ data: UPLOAD_RESULT }),
    });
    vi.stubGlobal('fetch', fetchMock);
    documentStub.cookie = '';
    vi.stubGlobal('document', documentStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastFetchInit(): RequestInit {
    return fetchMock.mock.calls[0][1] as RequestInit;
  }

  it('POSTs multipart form data to /uploads with credentials', async () => {
    const result = await uploadFile(file);

    expect(result).toEqual(UPLOAD_RESULT);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/uploads', expect.any(Object));
    const init = lastFetchInit();
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
  });

  it('does not set a Content-Type header (browser sets the multipart boundary)', async () => {
    await uploadFile(file);
    const headers = lastFetchInit().headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('attaches x-csrf-token from the hearth.csrf cookie', async () => {
    documentStub.cookie = 'hearth.csrf=upload-token';
    await uploadFile(file);
    const headers = lastFetchInit().headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('upload-token');
  });

  it('omits x-csrf-token when no cookie is present', async () => {
    await uploadFile(file);
    const headers = lastFetchInit().headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBeUndefined();
  });

  it('returns null on a non-OK response instead of throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: () => Promise.resolve({ error: 'File too large' }),
    });
    await expect(uploadFile(file)).resolves.toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(uploadFile(file)).resolves.toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('bad json')),
    });
    await expect(uploadFile(file)).resolves.toBeNull();
  });
});
