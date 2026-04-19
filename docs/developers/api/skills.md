# Skills

Skills are reusable capabilities that extend the AI agent's behavior. They can be created by users, shared across teams or the organization, and go through a review workflow before being published. Skills can also be imported from external sources.

## Authentication

All endpoints require an authenticated session (HTTP-only cookie). Admin endpoints require the `admin` role.

## Endpoints

### Discovery

#### GET /api/v1/skills/installed

List skills installed by the current user.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "skill_abc123",
      "name": "Code Review",
      "description": "Performs thorough code review with best practices",
      "scope": "org",
      "status": "published",
      "installedAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

---

#### GET /api/v1/skills

List all available skills with optional filtering.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Search by name or description |
| `scope` | string | No | Filter by scope: `"user"`, `"team"`, or `"org"` |
| `status` | string | No | Filter by status: `"draft"`, `"in_review"`, `"published"` |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "skill_abc123",
      "name": "Code Review",
      "description": "Performs thorough code review with best practices",
      "scope": "org",
      "status": "published",
      "createdAt": "2026-04-10T08:00:00Z",
      "updatedAt": "2026-04-12T14:00:00Z"
    }
  ]
}
```

---

#### GET /api/v1/skills/:id

Get a single skill by ID, including its full content.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Skill ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "skill_abc123",
    "name": "Code Review",
    "description": "Performs thorough code review with best practices",
    "content": "When reviewing code, analyze for...",
    "scope": "org",
    "status": "published",
    "teamId": null,
    "createdAt": "2026-04-10T08:00:00Z",
    "updatedAt": "2026-04-12T14:00:00Z"
  }
}
```

---

### Management

#### POST /api/v1/skills

Create a new skill.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Skill name |
| `description` | string | Yes | Brief description |
| `content` | string | Yes | Skill instructions/content |
| `scope` | string | No | `"user"`, `"team"`, or `"org"` (default: `"user"`) |
| `teamId` | string | No | Team ID (required when scope is `"team"`) |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "skill_new789",
    "name": "API Documentation",
    "description": "Generates API documentation from code",
    "content": "When documenting an API...",
    "scope": "user",
    "status": "draft",
    "teamId": null,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:00:00Z"
  }
}
```

---

#### PATCH /api/v1/skills/:id

Update a skill.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Skill ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Updated name |
| `description` | string | No | Updated description |
| `content` | string | No | Updated content |
| `scope` | string | No | Updated scope |
| `teamId` | string | No | Updated team ID |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "skill_new789",
    "name": "API Documentation v2",
    "description": "Generates comprehensive API documentation from code",
    "content": "When documenting an API...",
    "scope": "user",
    "status": "draft",
    "teamId": null,
    "createdAt": "2026-04-17T10:00:00Z",
    "updatedAt": "2026-04-17T10:10:00Z"
  }
}
```

---

#### DELETE /api/v1/skills/:id

Delete a skill. Requires `admin` role for org-scoped skills.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Skill ID |

**Response:** `200 OK`

```json
{
  "data": { "deleted": true }
}
```

---

### Installation

#### POST /api/v1/skills/:id/install

Install a published skill for the current user.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Skill ID |

**Response:** `200 OK`

```json
{
  "data": { "installed": true }
}
```

---

#### DELETE /api/v1/skills/:id/install

Uninstall a skill for the current user.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Skill ID |

**Response:** `200 OK`

```json
{
  "data": { "uninstalled": true }
}
```

---

### Review Workflow

#### GET /api/v1/skills/proposals

List skill proposals pending review.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | No | Filter proposals linked to a specific task |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "skill_prop001",
      "name": "Sprint Planning",
      "description": "Facilitates sprint planning sessions",
      "status": "in_review",
      "submittedBy": "user_abc",
      "createdAt": "2026-04-16T15:00:00Z"
    }
  ]
}
```

---

#### POST /api/v1/skills/:id/submit-for-review

Submit a draft skill for review.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Skill ID (must be in `"draft"` status) |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "skill_new789",
    "status": "in_review",
    "updatedAt": "2026-04-17T10:15:00Z"
  }
}
```

---

#### DELETE /api/v1/skills/:id/proposal

Withdraw a skill proposal from review.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Skill ID |

**Response:** `200 OK`

```json
{
  "data": { "withdrawn": true }
}
```

---

### Import

#### POST /api/v1/skills/seed

Seed the system with default skills. Typically run during initial setup.

**Response:** `200 OK`

```json
{
  "data": { "seeded": true, "count": 5 }
}
```

---

#### POST /api/v1/skills/import/preview

Preview a skill from an external URL before importing.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL to fetch the skill from |

**Response:** `200 OK`

```json
{
  "data": {
    "name": "External Code Review",
    "description": "Code review skill from community repository",
    "content": "When reviewing code...",
    "source": "https://example.com/skills/code-review"
  }
}
```

---

#### POST /api/v1/skills/import

Import a skill from an external source or custom definition.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | No | Source URL (if importing from external) |
| `name` | string | Yes | Skill name |
| `description` | string | Yes | Skill description |
| `content` | string | Yes | Skill content |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "skill_imp001",
    "name": "External Code Review",
    "description": "Code review skill from community repository",
    "content": "When reviewing code...",
    "scope": "user",
    "status": "draft",
    "createdAt": "2026-04-17T10:20:00Z",
    "updatedAt": "2026-04-17T10:20:00Z"
  }
}
```

---

### Recommendations

#### GET /api/v1/recommendations/skills

Get AI-powered skill recommendations for the current user.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Maximum recommendations to return |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "skill_rec001",
      "name": "Test Generation",
      "description": "Generates comprehensive test suites",
      "reason": "Based on your recent testing tasks"
    }
  ]
}
```

## Types

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  scope: "user" | "team" | "org";
  status: "draft" | "in_review" | "published";
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SkillProposal {
  id: string;
  name: string;
  description: string;
  status: "in_review";
  submittedBy: string;
  createdAt: string;
}

interface SkillRecommendation {
  id: string;
  name: string;
  description: string;
  reason: string;
}
```
