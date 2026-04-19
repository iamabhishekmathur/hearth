# Compliance Packs

Automatic detection and scrubbing of sensitive data before it reaches external LLM providers. Requires the **admin** role.

## Overview

When users send messages through Hearth, that content -- including potentially sensitive PII, PHI, or financial data -- gets forwarded to external LLM providers. Compliance packs let org admins enable automatic detection and scrubbing of sensitive data **before** it leaves the platform, making Hearth viable for regulated environments (healthcare, finance, education).

Scrubbing is **transparent**: the LLM sees only placeholders like `[SSN_1]` or `[CREDIT_CARD_1]`, while the user sees their original values in the AI's response. No sensitive data is stored in token maps -- they exist only in memory for the duration of a single request.

## Key Concepts

- **Compliance Pack** -- A pre-built bundle of detectors focused on a specific category of sensitive data. Each pack contains multiple detectors and can be enabled or disabled for the organization.
- **Detector** -- An individual rule within a pack that identifies a specific type of sensitive entity (e.g., email addresses, credit card numbers, social security numbers). Detectors use regex patterns with optional validation functions (e.g., Luhn check for credit cards, ABA checksum for routing numbers).
- **Scrubbing** -- The process of replacing detected sensitive data with placeholders before the content is sent to the LLM. For example, `john@example.com` becomes `[EMAIL_1]`. Deterministic numbering ensures the same value always gets the same placeholder within a session.
- **Descrubbing** -- The reverse process: replacing placeholders in the LLM's response with original values before showing them to the user. Handles streaming responses where placeholders may be split across chunks.
- **Token Map** -- A session-scoped, in-memory mapping between placeholders and original values. Never persisted to disk or database.
- **Detector Override** -- Per-detector configuration that lets admins enable or disable individual detectors within an active pack. For example, disable `pii.EMAIL` if your org decides email addresses are acceptable to send to the LLM.
- **Audit Level** -- Controls how much detail is recorded when scrubbing occurs:
  - **summary** -- Logs that scrubbing happened and the count of entities found.
  - **detailed** -- Logs the specific entity types and counts per type.
- **User Override** -- When enabled, users can wrap content in `<safe>...</safe>` tags to bypass scrubbing for specific text. Disabled by default. All overrides are logged in the audit trail.

## Available Packs

### PII (Personally Identifiable Information)

**Category:** Privacy

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| SSN | `SSN` | Social Security Numbers (xxx-xx-xxxx) | Area number validation (rejects 000, 666, 900+) |
| Email | `EMAIL` | Email addresses | Pattern matching |
| Phone | `PHONE` | US phone numbers (multiple formats) | 10-11 digit validation |
| Person Name | `PERSON_NAME` | Names with titles (Mr., Dr.) or context keywords (patient, client) | Title or context required |
| Address | `ADDRESS` | US street addresses (number + street name + type) | Pattern matching |
| DOB | `DOB` | Dates of birth with context (DOB:, born on, birthday) | Context required |

### PCI-DSS (Payment Card Industry)

**Category:** Financial

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| Credit Card | `CREDIT_CARD` | Visa, Mastercard, Amex, Discover card numbers | **Luhn algorithm** checksum |
| CVV | `CVV` | Card verification values with context | Context required (CVV, security code) |
| Card Expiry | `CARD_EXPIRY` | Card expiration dates with context | Context required (exp, valid thru) |

### PHI (Protected Health Information)

**Category:** Healthcare -- **extends PII** (includes all PII detectors automatically)

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| MRN | `MRN` | Medical record numbers, patient IDs | Context required |
| Health Plan ID | `HEALTH_PLAN_ID` | Insurance IDs, member numbers, policy numbers | Context required |
| ICD Code | `ICD_CODE` | ICD-10 diagnosis codes | Context required |
| CPT Code | `CPT_CODE` | CPT procedure codes | Context required |
| Medication | `MEDICATION` | Medication names with dosage | Context required |

### GDPR (General Data Protection Regulation)

**Category:** Privacy -- **extends PII** (includes all PII detectors automatically)

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| EU National ID | `EU_NATIONAL_ID` | UK NI numbers, German IDs, French NIR | Pattern matching |
| IBAN | `IBAN` | International bank account numbers | Structure + length validation |
| EU VAT | `EU_VAT` | EU VAT registration numbers | Country code validation |
| EU Phone | `EU_PHONE` | European phone numbers with country codes | 9-15 digit validation |

### FERPA (Family Educational Rights and Privacy)

**Category:** Education

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| Student ID | `STUDENT_ID` | Student IDs and SIDs | Context required |
| Grade | `GRADE` | GPA values and letter grades | Context required |
| Enrollment | `ENROLLMENT` | University/course enrollment info | Context required |
| Transcript | `TRANSCRIPT` | Academic transcript references | Context required |

### Financial / SOX

**Category:** Financial

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| Account Number | `ACCOUNT_NUMBER` | Bank account numbers | Context required |
| Routing Number | `ROUTING_NUMBER` | ABA routing numbers | **ABA checksum** validation |
| Financial Amount | `FINANCIAL_AMOUNT` | Dollar amounts with financial context | Context required (salary, revenue, balance, etc.) |
| SWIFT Code | `SWIFT_CODE` | SWIFT/BIC codes | Context required |

## How It Works

### Data Flow

```
User sends message
  |
  v
Express middleware sets AsyncLocalStorage context (orgId, userId)
  |
  v
ProviderRegistry.chatWithFallback() is called
  |
  v
Compliance interceptor reads org config from cache
  |
  v
ComplianceScrubber.scrubChatParams()
  - Detects entities via regex + validators
  - Replaces: "John Smith" -> [PERSON_NAME_1], "123-45-6789" -> [SSN_1]
  - Builds session-scoped token map
  |
  v
Real LLM provider receives scrubbed params (no PII)
  |
  v
ComplianceScrubber.descrubStream()
  - Buffers text_delta events to handle split placeholders
  - Replaces [PERSON_NAME_1] -> "John Smith"
  |
  v
User sees original values in response
  |
  v
Audit log records compliance_scrub event (fire-and-forget)
```

### What Gets Scrubbed

- **User messages** -- all text content in the message array
- **System prompt** -- org identity, user memories, skill descriptions
- **Tool results** -- tool output that flows back as messages in subsequent LLM calls
- **Embedding texts** -- scrubbed before embedding (embeddings should not encode PII)

### What Gets Descrubbed

- **LLM text responses** -- placeholder tokens replaced with originals before reaching the user
- **Tool call arguments** -- when the LLM generates a tool call with `[PERSON_NAME_1]`, the arguments are descrubbed so external tools receive real values

### Stream Handling

LLM responses stream token-by-token. A placeholder like `[SSN_1]` might arrive as `[SS` in one chunk and `N_1]` in the next. The descrubber buffers text when it sees an opening `[` without a closing `]`, flushing once the placeholder is complete or the buffer exceeds 30 characters (not a placeholder).

## How To

### View available compliance packs

1. Go to **Settings > Compliance** (admin role required).
2. The page displays all available compliance packs with their name, description, category, and detector count.
3. Click "Show detectors" on any enabled pack to see individual detectors and their entity types.

### Configure compliance for your organization

1. Go to **Settings > Compliance**.
2. Toggle on the packs relevant to your industry:
   - **Software/SaaS:** PII
   - **Healthcare:** PHI (automatically includes PII)
   - **Finance:** PII + PCI-DSS + Financial
   - **EU operations:** GDPR (automatically includes PII)
   - **Education:** PII + FERPA
3. Optionally override individual detectors -- for example, disable `pii.EMAIL` if emails are acceptable to send to the LLM.
4. Set the **audit level** to `summary` or `detailed`.
5. Decide whether to **allow user overrides** (`<safe>` tags). Disabled by default.
6. Click **Save Configuration**. Changes take effect immediately.

### Test scrubbing on sample text

1. Enable at least one pack and scroll to the **Test Detection** section.
2. Enter sample text containing sensitive data (e.g., "Patient John Smith, SSN 123-45-6789, card 4111-1111-1111-1111").
3. Click **Test Detection**.
4. Review the results: scrubbed output, number of entities found, and a breakdown showing each detected entity with its type, original value, and placeholder.

You can also test via the API:

```bash
curl -X POST /api/v1/admin/compliance/test \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "SSN: 123-45-6789, Card: 4111-1111-1111-1111",
    "packIds": ["pii", "pci-dss"]
  }'
```

### Review scrubbing statistics

1. Go to **Settings > Compliance** and scroll to **Scrubbing Statistics**.
2. View aggregated stats for the last 30 days:
   - **Total scrubs** -- how many messages were scrubbed
   - **Total entities scrubbed** -- total count across all entity types
   - **Top entity types** -- ranked breakdown (SSN, EMAIL, PHONE, etc.)
   - **Pack usage** -- which packs were triggered and how often

### Export compliance data

Compliance scrubbing events are recorded in the audit logs under the `compliance_scrub` action type. Use the [Audit Logs](./audit-logs) interface or API to query, filter, and export these records. Each entry includes:

- Timestamp
- User who sent the message
- Which packs were active
- Entity counts by type
- Direction (outbound to LLM)

## API Reference

All endpoints require `admin` role. Base path: `/api/v1/admin/compliance`

### GET /packs

List all available compliance packs with their detectors.

**Response:**

```json
{
  "data": [
    {
      "id": "pii",
      "name": "PII (Personally Identifiable Information)",
      "description": "Detects and scrubs SSNs, email addresses, phone numbers...",
      "category": "privacy",
      "detectorCount": 6,
      "detectors": [
        { "id": "pii.SSN", "name": "Social Security Number", "entityType": "SSN" },
        { "id": "pii.EMAIL", "name": "Email Address", "entityType": "EMAIL" }
      ]
    }
  ]
}
```

### GET /config

Get the organization's current compliance configuration.

**Response:**

```json
{
  "data": {
    "enabledPacks": ["pii", "pci-dss"],
    "detectorOverrides": { "pii.EMAIL": { "enabled": false } },
    "auditLevel": "summary",
    "allowUserOverride": false
  }
}
```

### PUT /config

Update the compliance configuration. Changes take effect immediately.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabledPacks` | string[] | No | Pack IDs to enable |
| `detectorOverrides` | object | No | Per-detector overrides |
| `auditLevel` | string | No | `"summary"` or `"detailed"` |
| `allowUserOverride` | boolean | No | Allow `<safe>` tag bypass |

**Response:** `200 OK` with updated config.

### POST /test

Dry-run scrubbing on sample text. Does not affect real messages.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Sample text to scrub |
| `packIds` | string[] | Yes | Pack IDs to test against |

**Response:**

```json
{
  "data": {
    "scrubbedText": "SSN: [SSN_1], Card: [CREDIT_CARD_1]",
    "entitiesFound": 2,
    "entities": [
      { "type": "SSN", "original": "123-45-6789", "placeholder": "[SSN_1]" },
      { "type": "CREDIT_CARD", "original": "4111-1111-1111-1111", "placeholder": "[CREDIT_CARD_1]" }
    ]
  }
}
```

### GET /stats

Scrubbing statistics for the last 30 days.

**Response:**

```json
{
  "data": {
    "totalScrubs": 1247,
    "entityCounts": { "SSN": 89, "EMAIL": 342, "PHONE": 156 },
    "packUsage": { "pii": 1100, "pci-dss": 147 },
    "period": "last_30_days"
  }
}
```

## Configuration Storage

Compliance configuration is stored in the org's `settings` JSON column alongside other org settings:

```json
{
  "llm": { "defaultProvider": "anthropic", "defaultModel": "claude-sonnet-4-6" },
  "compliance": {
    "enabledPacks": ["pii", "pci-dss"],
    "detectorOverrides": { "pii.EMAIL": { "enabled": false } },
    "auditLevel": "summary",
    "allowUserOverride": false
  }
}
```

No database migration is required. Config is cached in-memory with a 60-second TTL and invalidated immediately on save.

## Tips

- **Start narrow, expand later.** Enable PII first, monitor for a week, then add domain-specific packs. This avoids over-scrubbing.
- **Use the test panel before going live.** Send realistic messages through the scrubber to verify detectors catch what you expect.
- **Set audit level to `detailed` initially** so you can see exactly what's being detected. Switch to `summary` once confident.
- **Token maps are ephemeral.** Original values are never stored in the database -- they exist only in memory for the duration of a single request. This avoids creating another PII storage location.
- **Embeddings are scrubbed too.** This is intentional: vector embeddings should not encode PII. Memory search still works for topic-based queries.
- **Performance is fast.** Detection runs in <5ms for typical 1-2KB messages. No ML models, no GPU, no external services.
- **Packs can extend other packs.** PHI and GDPR automatically include all PII detectors. Enabling PHI alone gives you full PII + healthcare coverage.

## Limitations

- **Name detection is regex-based.** It requires context signals (titles like "Mr./Dr." or keywords like "patient", "client"). Names without context may not be detected. A future phase may add an optional NER sidecar.
- **No image scrubbing.** Compliance packs only process text content. Image attachments pass through unmodified.
- **Single-org.** The current implementation assumes a single org per deployment. Multi-org support would require per-org interceptor configuration.

## Related

- [Audit Logs](./audit-logs) -- Scrubbing events appear as `compliance_scrub` entries in the audit trail.
- [Governance](./governance) -- Governance policies handle content rules (what users are allowed to discuss); compliance packs handle sensitive data protection (what the LLM is allowed to see). They work together but serve different purposes.
- [Analytics](./analytics) -- Usage analytics can help identify which conversations generate the most compliance events.
