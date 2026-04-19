const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)hearth\.csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

interface UploadResult {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

/**
 * Uploads a file to the server and returns the upload metadata.
 * Uses multipart/form-data instead of JSON.
 */
export async function uploadFile(file: File): Promise<UploadResult | null> {
  const formData = new FormData();
  formData.append('file', file);

  const headers: Record<string, string> = {};
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  try {
    const res = await fetch(`${BASE_URL}/uploads`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
    });

    if (!res.ok) {
      return null;
    }

    const body = (await res.json()) as { data: UploadResult };
    return body.data;
  } catch {
    return null;
  }
}
