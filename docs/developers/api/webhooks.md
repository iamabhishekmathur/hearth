# Webhooks & Uploads

Endpoints for receiving inbound webhooks from external services and handling file uploads.

## Authentication

- **Webhook ingestion** does not use session authentication. Instead, each webhook endpoint has a unique URL token and verifies payloads using provider-specific signature mechanisms.
- **Upload endpoints** require an authenticated session (HTTP-only cookie).

## Endpoints

### Webhooks

#### POST /api/v1/webhooks/ingest/:urlToken

Receive an inbound webhook payload. This endpoint is called by external services (GitHub, Slack, Jira, etc.) when events occur. The payload is verified, normalized, deduplicated, and matched against routine triggers.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `urlToken` | string | Unique token identifying the webhook endpoint |

**Request Body:**

The raw payload from the external service. The content type and structure vary by provider.

**Response:** `200 OK`

```json
{
  "data": { "received": true }
}
```

**Error Responses:**

| Status | Condition |
|--------|-----------|
| `400 Bad Request` | Invalid or missing payload |
| `401 Unauthorized` | Signature verification failed |
| `404 Not Found` | Unknown URL token |
| `409 Conflict` | Duplicate event (already processed) |

#### Signature Verification

Each provider uses a different signature mechanism to verify that webhooks are authentic:

| Provider | Header | Algorithm |
|----------|--------|-----------|
| GitHub | `X-Hub-Signature-256` | HMAC-SHA256 of the request body using the webhook secret |
| Slack | `X-Slack-Signature` | HMAC-SHA256 of `v0:timestamp:body` using the signing secret |
| Jira | `X-Hub-Signature` | HMAC-SHA256 of the request body using the shared secret |
| Generic | `X-Webhook-Signature` | HMAC-SHA256 of the request body using the configured secret |

The server compares the computed signature against the value in the provider's header. Requests with invalid or missing signatures are rejected with `401 Unauthorized`.

#### Deduplication

Each webhook event is assigned a unique identifier (extracted from provider-specific headers or generated from the payload). If a webhook with the same identifier has already been processed, the server responds with `409 Conflict` and does not re-process the event. This prevents duplicate routine executions from webhook retries.

| Provider | Dedup Key Source |
|----------|-----------------|
| GitHub | `X-GitHub-Delivery` header |
| Slack | Event `event_id` field |
| Jira | `X-Atlassian-Webhook-Identifier` header |
| Generic | SHA-256 hash of the request body |

#### Trigger Matching

After verification and deduplication, the webhook payload is normalized into a standard event format and matched against routine triggers. If a matching trigger is found, the associated routine is queued for execution with the webhook payload available in its context.

---

### Uploads

#### POST /api/v1/uploads

Upload a file. Files can be attached to chat messages.

**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | Yes | The file to upload |

**Constraints:**

| Constraint | Value |
|------------|-------|
| Maximum file size | 10 MB |
| Allowed image types | `image/png`, `image/jpeg`, `image/gif`, `image/webp` |
| Allowed document types | `application/pdf`, `text/plain`, `text/markdown`, `application/json` |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "upload_abc123",
    "filename": "screenshot.png",
    "mimeType": "image/png",
    "size": 245760,
    "path": "uploads/2026/04/17/upload_abc123_screenshot.png",
    "createdAt": "2026-04-17T10:00:00Z"
  }
}
```

**Error Responses:**

| Status | Condition |
|--------|-----------|
| `400 Bad Request` | No file provided or unsupported file type |
| `413 Payload Too Large` | File exceeds 10 MB limit |

---

#### GET /api/v1/uploads/:filePath

Serve an uploaded file. The file path is validated to prevent path traversal attacks.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | string | File path as returned in the upload response |

**Response:** `200 OK`

Returns the file with the appropriate `Content-Type` header.

**Error Responses:**

| Status | Condition |
|--------|-----------|
| `400 Bad Request` | Path traversal detected |
| `404 Not Found` | File does not exist |

#### Security

- File paths are validated against path traversal patterns (`..`, absolute paths, null bytes).
- Files are stored in a sandboxed directory and served with appropriate content-type headers.
- Only authenticated users can access uploaded files.

## Types

```typescript
interface WebhookEndpoint {
  id: string;
  urlToken: string;
  routineId: string;
  provider: "github" | "slack" | "jira" | "generic";
  secret: string;
  createdAt: string;
}

interface WebhookEvent {
  id: string;
  endpointId: string;
  provider: string;
  eventType: string;
  payload: Record<string, any>;
  dedupKey: string;
  processedAt: string;
}

interface Upload {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: string;
}
```
