import type { ApiResponse } from '@hearth/shared';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)hearth\.csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const method = (options.method ?? 'GET').toUpperCase();
  const csrfHeaders: Record<string, string> = {};
  if (STATE_CHANGING.has(method)) {
    const token = getCsrfToken();
    if (token) csrfHeaders['x-csrf-token'] = token;
  }
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders,
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as ApiResponse;
      if (body.error) message = body.error;
      else if (body.message) message = body.message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};

export { ApiError };
