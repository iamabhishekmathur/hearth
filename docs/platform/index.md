# Admin Guide

Complete reference for configuring and managing your Hearth deployment. Most features in this section require the **admin** role.

[[toc]]

---

## Users & Teams

Manage user accounts, assign roles, and organize people into teams. Requires the **admin** role.

### Overview

Users & Teams is where admins control who has access to Hearth and how they are organized. Every person in the platform has one of three roles -- admin, team lead, or member -- which determines what they can see and do. Teams group users together for shared context and collaboration.

### Key Concepts

- **Roles** -- Hearth has three user roles:
  - **admin** -- Full platform control. Can manage all users, teams, integrations, LLM configuration, governance policies, and compliance settings.
  - **team_lead** -- Can manage their own team's membership and team-level memory. Cannot access platform-wide admin settings.
  - **member** -- Standard access. Can use chat, routines, skills, and memory but cannot manage other users or teams.
- **User** -- An individual account identified by name, email, and role. Users belong to an organization and optionally to one or more teams.
- **Team** -- A named group of users. Each team can have a designated lead and any number of members. Teams share context that the AI can reference during conversations.
- **Deactivation** -- Admins can deactivate a user account without deleting it. Deactivated users cannot log in but their data (messages, memory, audit trail) is preserved.

### View all users

1. Go to **Settings > Users**.
2. The user list displays all accounts in your organization with their name, email, and role.
3. Use the search field to filter by name or email.
4. Results are paginated -- use the page controls at the bottom to navigate.

### Create a new user

1. Go to **Settings > Users**.
2. Click the **Add User** button.
3. Fill in the required fields: name, email, and role (admin, team_lead, or member).
4. Click **Save**. The user receives login credentials.

### Edit a user

1. Go to **Settings > Users**.
2. Find the user in the list and click their row to expand the edit controls.
3. Change the role using the dropdown, or update their name.
4. Click **Save** to apply the changes.

### Deactivate a user

1. Go to **Settings > Users**.
2. Find the user and click the delete/deactivate action on their row.
3. Confirm the action. The user is deactivated and can no longer log in.
4. Their historical data remains intact for audit and compliance purposes.

### View all teams

1. Go to **Settings > Teams**.
2. The team list shows each team's name and member count.

### Create a new team

1. Go to **Settings > Teams**.
2. Click the **Create Team** button.
3. Enter a team name.
4. Click **Save**. The team is created with no members.

### Assign members to a team

1. Go to **Settings > Teams** and select the team you want to manage.
2. Use the member assignment controls to add or remove users.
3. Designate a team lead by selecting the lead role for one of the members.
4. Click **Save** to apply the changes.

### Delete a team

1. Go to **Settings > Teams**.
2. Find the team you want to remove and click the delete action.
3. Confirm the deletion. Members are not deleted -- they simply no longer belong to that team.

### Users & Teams API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/users` | List all users (paginated, filterable) |
| PATCH | `/api/v1/admin/users/:id` | Update a user's role or details |
| DELETE | `/api/v1/admin/users/:id` | Deactivate or remove a user |
| GET | `/api/v1/admin/teams` | List all teams |
| POST | `/api/v1/admin/teams` | Create a new team |
| PATCH | `/api/v1/admin/teams/:id` | Update team name or membership |
| DELETE | `/api/v1/admin/teams/:id` | Delete a team |

### Users & Teams Tips

- Assign the team_lead role to people who need to manage their own team without having full admin access. Team leads can manage team membership and team-level memory.
- Deactivating a user is safer than deleting them. Deactivated accounts preserve the audit trail and can be reactivated later if needed.
- Use teams to mirror your real organizational structure. The AI uses team context to provide more relevant responses to team members.
- The user list supports deep-linking: navigate directly with `#/settings/users`.

---

## Integrations

Integrations connect Hearth to external tools via MCP (Model Context Protocol). Each connected service gives the AI tools it can use during conversations and routines.

### Overview

Hearth supports seven pre-built connectors: Slack, Gmail, Google Drive, Jira, Notion, GitHub, and Google Calendar. Each connector provides a set of tools the AI can call -- sending Slack messages, creating Jira tickets, searching Google Drive documents, and more. Admins configure integrations by providing credentials, which are encrypted with AES-256-GCM before storage and never logged or exposed in plaintext.

### Key Concepts

- **MCP (Model Context Protocol)** -- The standard protocol Hearth uses to communicate with external services. Each integration is an MCP connector that exposes tools the AI can call.
- **Connector** -- A pre-built adapter for a specific service (Slack, GitHub, etc.). Each connector defines the tools it provides and the credentials it requires.
- **Connection Status** -- Each integration reports one of three states: **connected** (working normally), **disconnected** (no credentials configured), or **error** (credentials invalid or service unreachable).
- **Health Check** -- Hearth periodically verifies that connected integrations are still working. The last check time and any error details are displayed on each connector card.
- **Credential Encryption** -- All integration tokens and API keys are encrypted with AES-256-GCM before being stored in the database. They are never displayed in full after being saved.

### Supported Connectors

#### Slack

- **Provider key:** `slack`
- **Credentials:** Signing secret + OAuth bot token (`xoxb-...`)
- **Tools:** Send messages to channels or users, read channel history, search conversations, list channels
- **Use cases:** Post routine summaries, notify teammates, surface Slack context in chat

#### Gmail

- **Provider key:** `gmail`
- **Credentials:** OAuth access token (`ya29...`)
- **Tools:** Read emails and threads, send emails, search inbox, manage labels
- **Use cases:** Summarize unread emails, draft replies, find emails related to a topic

#### Google Drive

- **Provider key:** `gdrive`
- **Credentials:** OAuth access token (`ya29...`)
- **Tools:** Read documents, create new documents, search files by name or content
- **Use cases:** Find reference documents, create meeting notes, search for specs

#### Jira

- **Provider key:** `jira`
- **Credentials:** Jira domain URL, email address, and API token
- **Tools:** Create issues, update issue status, search issues with JQL, manage sprints
- **Use cases:** Create tickets from chat, look up issue status, update sprint boards

#### Notion

- **Provider key:** `notion`
- **Credentials:** Integration token (`ntn_...`)
- **Tools:** Read pages and databases, create new pages, update existing pages, query databases
- **Use cases:** Look up documentation, create meeting notes, update project trackers

#### GitHub

- **Provider key:** `github`
- **Credentials:** Personal access token (`ghp_...`) or OAuth token
- **Tools:** Read and create issues, read and create pull requests, search code, list repositories
- **Use cases:** Create issues from conversations, check PR status, search codebase

#### Google Calendar

- **Provider key:** `gcalendar`
- **Credentials:** OAuth access token (`ya29...`)
- **Tools:** Read events, create new events, check availability, list upcoming meetings
- **Use cases:** Check schedule before booking, create events from chat, surface meeting context

### View integration status

1. Go to **Settings > Integrations** (admin role required).
2. Each connector card shows its current status: connected (green), disconnected (gray), or error (red).
3. Connected integrations display the last health check timestamp.
4. If a connector is in an error state, the card shows the error details.

### Connect a new integration

1. Go to **Settings > Integrations**.
2. Click **Add Integration** or find the connector you want to enable.
3. Select the provider (Slack, GitHub, Gmail, etc.).
4. Enter the required credentials for that provider (see the per-connector details above).
5. Click **Test Connection** to verify the credentials work before saving.
6. Click **Save** to store the encrypted credentials and activate the connector.
7. The connector's tools are now available to the AI in conversations and routines.

### Test a connection

1. After entering credentials, click **Test Connection**.
2. Hearth attempts to reach the external service with the provided credentials.
3. A success or failure message appears. If it fails, check that your token has the required scopes and has not expired.

### Reconnect a broken integration

1. Go to **Settings > Integrations**.
2. Find the integration showing an error status.
3. Expand the connector card and update the credentials if they have expired or been revoked.
4. Click **Test Connection** to verify, then **Save** to reconnect.
5. Alternatively, click the **Refresh** button to retry the connection with existing credentials.

### Disconnect an integration

1. Go to **Settings > Integrations**.
2. Find the connected integration you want to remove.
3. Click the disconnect or delete control on the connector card.
4. Confirm the action. The integration's credentials are removed and its tools become unavailable to the AI.

### Check integration health via API

Use the health endpoint to programmatically verify a connector's status:

```
GET /api/v1/admin/integrations/:id/health
```

The response includes connection status, last check time, and any error details.

### Integrations API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/integrations` | List all integrations and their status |
| POST | `/api/v1/admin/integrations` | Add a new integration |
| PATCH | `/api/v1/admin/integrations/:id` | Update integration credentials or settings |
| DELETE | `/api/v1/admin/integrations/:id` | Remove an integration |
| GET | `/api/v1/admin/integrations/:id/health` | Check health status of a specific integration |

### Integrations Tips

- Only admins can manage integrations, but all users benefit from connected services during AI conversations. The AI automatically uses available integration tools when relevant.
- Start with the integrations your team uses most. The AI only offers tool actions for connected services, so connecting Slack and Jira first means the AI can immediately help with communication and issue tracking.
- If an integration shows an error status, the most common cause is an expired token. OAuth tokens for Google services (Gmail, Drive, Calendar) need periodic refresh.
- Hearth health-checks integrations automatically. You can see the last checked time on each connector card to verify they are being monitored.
- Credentials are encrypted at rest with AES-256-GCM. After saving, only a masked preview is shown. The raw token cannot be retrieved.
- For Jira, you need three pieces of information: your Jira domain (e.g., `yourteam.atlassian.net`), the email address associated with your Atlassian account, and an API token generated from your Atlassian account settings.
- The Settings page supports deep-linking: navigate directly with `#/settings/integrations`.

---

## LLM Configuration

Configure AI providers and models for your organization. Requires the **admin** role.

### Overview

LLM Configuration controls which AI providers and models power Hearth. The platform supports three providers -- Anthropic, OpenAI, and Ollama (self-hosted) -- each with multiple model options. Admins set a default provider and model for the organization, store API keys securely, and can test connections before committing changes. The configuration applies immediately without requiring a restart.

### Key Concepts

- **Provider** -- An AI service that hosts language models. Hearth supports Anthropic, OpenAI, and Ollama.
- **Model** -- A specific AI model within a provider (e.g., Claude Sonnet 4.6, GPT-4o). Different models offer different tradeoffs between speed, quality, and cost.
- **Default Provider / Model** -- The organization-wide provider and model used for all conversations unless overridden by a user request.
- **API Key** -- The credential used to authenticate with a provider. Keys are encrypted with AES-256-GCM before storage. Keys can also be supplied via environment variables.
- **Key Source** -- Each provider shows where its key comes from: **db** (saved through the admin panel) or **env** (loaded from an environment variable). Environment variable keys are marked with an "env" badge.
- **Embedding Model** -- A separate model configuration used for generating vector embeddings (used by memory search and semantic similarity features).
- **Vision Support** -- Some models can process images. The vision toggle controls whether image analysis is available in chat.

### Supported Providers and Models

#### Anthropic

| Model | Model ID | Vision |
|-------|----------|--------|
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Yes |
| Claude Opus 4.6 | `claude-opus-4-6` | Yes |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Yes |

#### OpenAI

| Model | Model ID | Vision |
|-------|----------|--------|
| GPT-4o | `gpt-4o` | Yes |
| GPT-4o Mini | `gpt-4o-mini` | Yes |
| o3 | `o3` | No |
| o3-mini | `o3-mini` | No |
| o4-mini | `o4-mini` | Yes |

#### Ollama (Self-Hosted)

Ollama runs models locally on your infrastructure. The model list is dynamic -- any model pulled into your Ollama instance is available. Common choices include:

- Llama 3.2, Llama 3.1
- Mistral
- Qwen 2.5

Ollama is configured via the `OLLAMA_BASE_URL` environment variable rather than an API key.

### View current configuration

1. Go to **Settings > LLM Config**.
2. The page shows provider cards for Anthropic, OpenAI, and Ollama.
3. Each card displays whether the provider is configured, the key source (db or env), and the available models.
4. The current default provider and model are highlighted.

### Set up a provider

1. Go to **Settings > LLM Config**.
2. Expand the provider card you want to configure (e.g., Anthropic).
3. Enter the API key for that provider.
4. Click **Test** to verify the connection works.
5. Click **Save** to store the encrypted key.
6. The provider card now shows "configured" status.

### Choose the default provider and model

1. Go to **Settings > LLM Config**.
2. Select a **default provider** from the configured providers.
3. Select a **default model** from the models available for that provider.
4. Click **Save**. The change applies immediately to all new conversations.

### Toggle vision support

1. Go to **Settings > LLM Config**.
2. Find the **Vision** toggle.
3. Enable or disable vision support. When enabled, users can send images in chat and the AI will analyze them.
4. Vision requires a vision-capable model (see the tables above).

### Check embedding status

1. Go to **Settings > LLM Config**.
2. The embedding section shows the current embedding provider and its status.
3. Embeddings are used for memory search and semantic similarity. They are configured separately from the conversation model.

### LLM Configuration API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/llm-config` | Get current default provider, model, and vision setting |
| PUT | `/api/v1/admin/llm-config` | Update default provider, model, and vision setting |
| GET | `/api/v1/admin/llm-config/providers` | List all providers with configured status and available models |
| GET | `/api/v1/admin/llm-config/embedding` | Get embedding provider status |
| POST | `/api/v1/admin/llm-config/keys` | Save an encrypted API key for a provider |

### LLM Configuration Tips

- Start with one provider. You do not need to configure all three. Most teams begin with Anthropic or OpenAI and add others later.
- Always click **Test** before saving a new API key. This catches typos and permission issues immediately.
- API keys entered through the admin panel are encrypted with AES-256-GCM. If you prefer, you can set keys via environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`) instead. Environment-sourced keys are shown with an "env" badge and cannot be edited through the UI.
- Model selection follows a hierarchy: if a user specifies a model in their request, that takes precedence over the org default. Otherwise the org default is used.
- Ollama is a good choice for teams that need to keep data on-premises. Install Ollama on your infrastructure, pull your preferred models, and set `OLLAMA_BASE_URL` to point at it.
- Changes to the default provider and model take effect immediately. The provider registry is hot-reloaded -- no server restart is needed.
- The Settings page supports deep-linking: navigate directly with `#/settings/llm`.

---

## Soul & Identity

Personalize how the AI communicates and what it knows about you using markdown documents.

### Overview

Soul & Identity is Hearth's personalization system. It uses two types of markdown documents -- SOUL.md and IDENTITY.md -- to shape every AI interaction. SOUL.md controls how the AI communicates (tone, style, behavior), while IDENTITY.md tells the AI what it should know about you (role, expertise, preferences). Documents exist at both org and user levels, letting organizations set a baseline personality while individuals layer on personal preferences.

### Key Concepts

- **SOUL.md** -- Defines the AI's personality, tone, and communication style. Think of it as "how the agent should talk." Examples: preferred tone (direct, friendly, formal), response length preferences, whether to include code examples by default, how to handle uncertainty.
- **IDENTITY.md** -- Documents your working context, role, and preferences. Think of it as "what the agent should know about you." Examples: your role and expertise, current projects, tools and frameworks you prefer, how you like feedback.
- **Three document levels:**
  - **Org SOUL.md** (admin only) -- Organization-wide baseline personality. Sets the default tone and behavior for all users.
  - **User SOUL.md** -- Personal communication preferences that layer on top of the org baseline. Any user can edit their own.
  - **User IDENTITY.md** -- Your personal working context. Any user can edit their own.
- **System prompt construction** -- The AI reads all applicable documents before every interaction. The org SOUL.md is loaded first, then the user's SOUL.md and IDENTITY.md are layered on top. This happens automatically via the context builder.
- **Immediate effect** -- Changes to any document take effect on the very next message. No restart or refresh is needed.

### View your profile

1. Go to **Settings > Profile**.
2. Your name, email, and role are displayed. These fields reflect your account as set up by your admin.

### Define your AI personality (SOUL.md)

1. Go to **Settings > Soul & Identity**.
2. Click the **My SOUL.md** pill at the top of the editor.
3. Write markdown describing how you want the AI to communicate with you. For example:
   - Preferred tone (direct, friendly, formal)
   - Response length preferences (concise bullet points vs. detailed explanations)
   - Whether to include code examples by default
   - How to handle uncertainty or ambiguity
4. Click **Save**.
5. The agent reads this document and adjusts its responses accordingly.

### Document your working style (IDENTITY.md)

1. Go to **Settings > Soul & Identity**.
2. Click the **My IDENTITY.md** pill at the top of the editor.
3. Write markdown describing yourself and your work context. For example:
   - Your role and areas of expertise
   - Projects you are currently working on
   - Tools and frameworks you prefer
   - How you like to receive feedback
   - Working hours and timezone
4. Click **Save**.
5. The agent uses this to provide more relevant, personalized responses.

### Set the organization AI personality (admin only)

1. Go to **Settings > Soul & Identity**.
2. Click the **Org SOUL.md** pill (visible only to admins).
3. Write markdown defining the organization-wide AI personality. This sets the baseline tone and behavior for all users.
4. Click **Save**.
5. Individual users' SOUL.md files layer on top of this, so personal preferences can override or extend the org defaults.

### Soul & Identity API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/identity/:level/:fileType` | Get a document (level: `org` or `user`, fileType: `soul` or `identity`) |
| PUT | `/api/v1/identity/:level/:fileType` | Create or update a document (body: `{ content: "..." }`) |

The `level` parameter determines scope:
- `org` -- Organization-wide document. Only admins can write org-level documents.
- `user` -- Personal document. Any authenticated user can read and write their own.

The `fileType` parameter selects the document type:
- `soul` -- Communication style and personality.
- `identity` -- Working context and preferences.

### Soul & Identity Tips

- Start with your SOUL.md to set communication preferences, then add IDENTITY.md for deeper personalization. Even a few bullet points make a noticeable difference.
- The agent reads both documents before every response. Changes take effect immediately after saving -- no restart needed.
- The Org SOUL.md is a good place to encode team norms: "Always cite sources," "Use metric units," "Default to TypeScript examples," "Respond in Spanish," etc.
- You can use full markdown syntax in both documents, including headers, lists, code blocks, and emphasis.
- Keep documents focused. A concise SOUL.md with clear preferences (5-15 bullet points) works better than a lengthy essay.
- IDENTITY.md is especially powerful when it includes current context: "I'm working on the billing migration this sprint" helps the AI give you relevant answers without being asked.
- Settings supports deep-linking via URL hash. Navigate directly to the identity editor with `#/settings/identity`.

---

## Governance

Control what the AI can and cannot do with policies, approval workflows, and skill governance. Requires the **admin** role.

### Overview

Governance gives admins fine-grained control over AI behavior across the organization. It includes three pillars: policy enforcement (rules that check messages for prohibited content), skill governance (approving or blocking AI capabilities), and violation tracking (monitoring and reviewing policy breaches). Policies can block user messages before they reach the AI or flag AI responses after generation.

### Key Concepts

- **Policy** -- A named rule that checks message content against defined criteria. Each policy has a rule type, severity, enforcement mode, and scope.
- **Rule Types** -- Three ways to define what a policy detects:
  - **keyword** -- Matches exact keywords or phrases in message content.
  - **regex** -- Matches a regular expression pattern against message content.
  - **llm_evaluation** -- Uses an LLM to evaluate whether content violates the policy (more flexible but higher latency).
- **Enforcement** -- Determines what happens when a policy is triggered:
  - **monitor** -- The violation is logged silently for admin review. The user is not notified.
  - **warn** -- The violation is logged and the user sees a warning banner on the flagged message. The message is still sent to the AI.
  - **block** -- The message is stopped and not sent to the AI. The user receives a `governance:blocked` WebSocket event with the policy name, severity, and reason. The API returns HTTP 403.
- **Severity** -- Policies are categorized by severity: `info`, `warning`, or `critical`. This helps admins prioritize violations during review. Critical violations get a red accent in the dashboard.
- **Scope** -- Policies can target:
  - **User messages** -- Checked before sending to the LLM. Blocking policies can prevent the request entirely.
  - **AI responses** -- Checked after the LLM generates a response. Non-blocking; violations are logged but the response is delivered.
- **Violation** -- A recorded instance of a policy being triggered. Violations include the policy name, the flagged content, the user, and a timestamp.
- **Skill Governance** -- Separate from message policies. Admins approve or reject skill proposals and maintain blocklists to control which skills are available to the organization.
- **Governance Settings** -- Organization-level toggles that control the overall governance system: enable/disable governance, toggle user message checking, toggle AI response checking, admin notifications, and the monitoring banner.

### How It Works

Governance operates as a defense-in-depth system with three layers:

1. **System prompt injection** -- When governance is enabled, active policy descriptions are automatically injected into the AI's system prompt. This makes the AI proactively refuse to help with policy violations before they happen. For example, if a "No PII Sharing" policy exists, the AI will decline requests to share personal information and explain which guideline applies.

2. **Message evaluation** -- Every user message (and optionally AI responses) is evaluated against all enabled policies. Keyword and regex rules run in-process in microseconds. LLM evaluation rules use a cheap model (Haiku) for cost-efficient semantic analysis. Evaluation is asynchronous for monitor/warn policies (non-blocking) and synchronous for block policies.

3. **Violation tracking and review** -- Detected violations are persisted to the database, logged to the audit trail (visible in the activity feed), and pushed to admins via real-time WebSocket notifications. Admins can review, acknowledge, dismiss, or escalate violations. All review actions are themselves audited.

**Per-team/per-user scoping** -- Policies can be scoped to specific teams or users. An empty scope (default) applies to all users in the org.

**Monitoring banner** -- When enabled, a subtle banner appears in the chat interface informing users that governance monitoring is active. This promotes self-regulation.

### Enable governance

1. Go to **Settings > Governance** (or use the API).
2. Toggle governance **on** for your organization.
3. Configure the high-level settings:
   - **Check user messages** -- Evaluate user messages before they are sent to the AI.
   - **Check AI responses** -- Evaluate AI responses after generation.
   - **Notify admins** -- Send notifications when violations occur.
   - **Monitoring banner** -- Show users a banner indicating that governance monitoring is active.
4. Click **Save**.

### Create a policy

1. Navigate to the governance policies section.
2. Click **Create Policy**.
3. Fill in the policy details:
   - **Name** -- A descriptive name (e.g., "No PII sharing", "Block competitor mentions").
   - **Description** -- What the policy is intended to prevent.
   - **Category** -- Optional grouping for organizational purposes.
   - **Severity** -- `info`, `warning`, or `critical`.
   - **Rule type** -- `keyword`, `regex`, or `llm_evaluation`.
   - **Rule config** -- The matching criteria (keywords list, regex pattern, or evaluation prompt).
   - **Enforcement** -- `monitor` (logs only), `warn` (logs and notifies user), or `block` (stops the message).
   - **Scope** -- Which teams or users the policy applies to (empty = all users).
4. Click **Save**. The policy takes effect immediately.

### Test a policy

1. Use the policy test endpoint to dry-run a rule against sample text before deploying it.
2. Send a POST request to `/api/v1/admin/governance/policies/test` with:
   - `ruleType` -- The rule type to test.
   - `ruleConfig` -- The matching configuration.
   - `sampleMessage` -- The text to evaluate.
3. The response shows whether any violations would be triggered and their details.

### Review violations

1. Navigate to the governance violations section.
2. View the list of recorded violations, filtered by severity, status, user, or policy.
3. Click a violation to see its full details: the flagged content, which policy triggered it, the user, and the timestamp.
4. Take action on each violation:
   - **Acknowledge** -- Mark it as reviewed.
   - **Dismiss** -- Mark it as a false positive or non-issue.
   - **Escalate** -- Flag it for further review (requires a note explaining why).

### View governance statistics

1. Use the stats endpoint to get an overview of violation counts and trends.
2. GET `/api/v1/admin/governance/stats?since=2026-01-01` returns aggregated violation data.

### Export violations

1. GET `/api/v1/admin/governance/export?format=csv` to download violations as a CSV file.
2. Supports `format=csv` or `format=json`.
3. Filter by date range using `since` and `until` query parameters.

### Govern skills

1. Go to **Settings > Skills**.
2. View all skills in the catalog with their status and usage metrics.
3. Approve or reject skill proposals to control which skills are available to the organization.
4. Block skills that are inappropriate or no longer needed.

### Governance API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/governance/settings` | Get governance settings |
| PUT | `/api/v1/admin/governance/settings` | Update governance settings |
| GET | `/api/v1/admin/governance/policies` | List all policies |
| POST | `/api/v1/admin/governance/policies` | Create a new policy |
| GET | `/api/v1/admin/governance/policies/:id` | Get a single policy |
| PUT | `/api/v1/admin/governance/policies/:id` | Update a policy |
| DELETE | `/api/v1/admin/governance/policies/:id` | Delete a policy |
| POST | `/api/v1/admin/governance/policies/test` | Dry-run a rule against sample text |
| GET | `/api/v1/admin/governance/violations` | List violations (filterable, paginated) |
| GET | `/api/v1/admin/governance/violations/:id` | Get a single violation |
| PATCH | `/api/v1/admin/governance/violations/:id` | Review a violation (acknowledge, dismiss, escalate) |
| GET | `/api/v1/admin/governance/stats` | Get violation statistics |
| GET | `/api/v1/admin/governance/export` | Export violations as CSV or JSON |

### Governance Tips

- Start with **monitor** enforcement to understand what would be flagged before switching to **warn** or **block**. This avoids disrupting users while you tune your rules.
- Use the `keyword` rule type for simple, exact-match scenarios (e.g., specific terms like "password" or competitor names). Use `regex` for pattern-based matching (e.g., SSN patterns like `\b\d{3}-\d{2}-\d{4}\b`). Reserve `llm_evaluation` for nuanced semantic checks that require understanding context.
- When a **block** policy triggers on a user message, the API returns HTTP 403 and the user receives a `governance:blocked` WebSocket event containing the `policyName`, `severity`, and `reason`. The frontend displays this as a blocked message indicator.
- When a **warn** policy triggers, the message still goes through to the AI, but the user sees a warning indicator on the flagged message.
- Review violations regularly. The violations list supports filtering by severity, status, user, and policy, making it easy to focus on high-priority items.
- The monitoring banner is optional but recommended for transparency. When enabled, users see an indicator that governance monitoring is active.
- Export violations periodically for compliance reporting. Both CSV and JSON formats are available.

---

## Compliance

Automatic detection and scrubbing of sensitive data before it reaches external LLM providers. Requires the **admin** role.

### Overview

When users send messages through Hearth, that content -- including potentially sensitive PII, PHI, or financial data -- gets forwarded to external LLM providers. Compliance packs let org admins enable automatic detection and scrubbing of sensitive data **before** it leaves the platform, making Hearth viable for regulated environments (healthcare, finance, education).

Scrubbing is **transparent**: the LLM sees only placeholders like `[SSN_1]` or `[CREDIT_CARD_1]`, while the user sees their original values in the AI's response. No sensitive data is stored in token maps -- they exist only in memory for the duration of a single request.

### Key Concepts

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

### Available Packs

#### PII (Personally Identifiable Information)

**Category:** Privacy

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| SSN | `SSN` | Social Security Numbers (xxx-xx-xxxx) | Area number validation (rejects 000, 666, 900+) |
| Email | `EMAIL` | Email addresses | Pattern matching |
| Phone | `PHONE` | US phone numbers (multiple formats) | 10-11 digit validation |
| Person Name | `PERSON_NAME` | Names with titles (Mr., Dr.) or context keywords (patient, client) | Title or context required |
| Address | `ADDRESS` | US street addresses (number + street name + type) | Pattern matching |
| DOB | `DOB` | Dates of birth with context (DOB:, born on, birthday) | Context required |

#### PCI-DSS (Payment Card Industry)

**Category:** Financial

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| Credit Card | `CREDIT_CARD` | Visa, Mastercard, Amex, Discover card numbers | **Luhn algorithm** checksum |
| CVV | `CVV` | Card verification values with context | Context required (CVV, security code) |
| Card Expiry | `CARD_EXPIRY` | Card expiration dates with context | Context required (exp, valid thru) |

#### PHI (Protected Health Information)

**Category:** Healthcare -- **extends PII** (includes all PII detectors automatically)

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| MRN | `MRN` | Medical record numbers, patient IDs | Context required |
| Health Plan ID | `HEALTH_PLAN_ID` | Insurance IDs, member numbers, policy numbers | Context required |
| ICD Code | `ICD_CODE` | ICD-10 diagnosis codes | Context required |
| CPT Code | `CPT_CODE` | CPT procedure codes | Context required |
| Medication | `MEDICATION` | Medication names with dosage | Context required |

#### GDPR (General Data Protection Regulation)

**Category:** Privacy -- **extends PII** (includes all PII detectors automatically)

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| EU National ID | `EU_NATIONAL_ID` | UK NI numbers, German IDs, French NIR | Pattern matching |
| IBAN | `IBAN` | International bank account numbers | Structure + length validation |
| EU VAT | `EU_VAT` | EU VAT registration numbers | Country code validation |
| EU Phone | `EU_PHONE` | European phone numbers with country codes | 9-15 digit validation |

#### FERPA (Family Educational Rights and Privacy)

**Category:** Education

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| Student ID | `STUDENT_ID` | Student IDs and SIDs | Context required |
| Grade | `GRADE` | GPA values and letter grades | Context required |
| Enrollment | `ENROLLMENT` | University/course enrollment info | Context required |
| Transcript | `TRANSCRIPT` | Academic transcript references | Context required |

#### Financial / SOX

**Category:** Financial

| Detector | Entity Type | What it detects | Validation |
|----------|-------------|-----------------|------------|
| Account Number | `ACCOUNT_NUMBER` | Bank account numbers | Context required |
| Routing Number | `ROUTING_NUMBER` | ABA routing numbers | **ABA checksum** validation |
| Financial Amount | `FINANCIAL_AMOUNT` | Dollar amounts with financial context | Context required (salary, revenue, balance, etc.) |
| SWIFT Code | `SWIFT_CODE` | SWIFT/BIC codes | Context required |

### How It Works

#### Data Flow

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

#### What Gets Scrubbed

- **User messages** -- all text content in the message array
- **System prompt** -- org identity, user memories, skill descriptions
- **Tool results** -- tool output that flows back as messages in subsequent LLM calls
- **Embedding texts** -- scrubbed before embedding (embeddings should not encode PII)

#### What Gets Descrubbed

- **LLM text responses** -- placeholder tokens replaced with originals before reaching the user
- **Tool call arguments** -- when the LLM generates a tool call with `[PERSON_NAME_1]`, the arguments are descrubbed so external tools receive real values

#### Stream Handling

LLM responses stream token-by-token. A placeholder like `[SSN_1]` might arrive as `[SS` in one chunk and `N_1]` in the next. The descrubber buffers text when it sees an opening `[` without a closing `]`, flushing once the placeholder is complete or the buffer exceeds 30 characters (not a placeholder).

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

Compliance scrubbing events are recorded in the audit logs under the `compliance_scrub` action type. Use the [Audit Logs](#audit-logs) interface or API to query, filter, and export these records. Each entry includes:

- Timestamp
- User who sent the message
- Which packs were active
- Entity counts by type
- Direction (outbound to LLM)

### Compliance API Reference

All endpoints require `admin` role. Base path: `/api/v1/admin/compliance`

#### GET /packs

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

#### GET /config

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

#### PUT /config

Update the compliance configuration. Changes take effect immediately.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabledPacks` | string[] | No | Pack IDs to enable |
| `detectorOverrides` | object | No | Per-detector overrides |
| `auditLevel` | string | No | `"summary"` or `"detailed"` |
| `allowUserOverride` | boolean | No | Allow `<safe>` tag bypass |

**Response:** `200 OK` with updated config.

#### POST /test

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

#### GET /stats

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

### Configuration Storage

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

### Compliance Tips

- **Start narrow, expand later.** Enable PII first, monitor for a week, then add domain-specific packs. This avoids over-scrubbing.
- **Use the test panel before going live.** Send realistic messages through the scrubber to verify detectors catch what you expect.
- **Set audit level to `detailed` initially** so you can see exactly what's being detected. Switch to `summary` once confident.
- **Token maps are ephemeral.** Original values are never stored in the database -- they exist only in memory for the duration of a single request. This avoids creating another PII storage location.
- **Embeddings are scrubbed too.** This is intentional: vector embeddings should not encode PII. Memory search still works for topic-based queries.
- **Performance is fast.** Detection runs in <5ms for typical 1-2KB messages. No ML models, no GPU, no external services.
- **Packs can extend other packs.** PHI and GDPR automatically include all PII detectors. Enabling PHI alone gives you full PII + healthcare coverage.

### Compliance Limitations

- **Name detection is regex-based.** It requires context signals (titles like "Mr./Dr." or keywords like "patient", "client"). Names without context may not be detected. A future phase may add an optional NER sidecar.
- **No image scrubbing.** Compliance packs only process text content. Image attachments pass through unmodified.
- **Single-org.** The current implementation assumes a single org per deployment. Multi-org support would require per-org interceptor configuration.

---

## Analytics

Organization-wide usage metrics, feature adoption, and cost tracking. Requires the **admin** role.

### Overview

Analytics gives admins visibility into how the organization is using Hearth. The dashboard covers user activity, message volumes, feature adoption, token consumption by provider, and session statistics. All data is scoped to your organization and configurable by time range, with a default window of 30 days.

### Key Concepts

- **Active Users** -- The number of distinct users who sent at least one message or performed an action within the selected time range.
- **Sessions** -- Chat conversation threads created during the period. Tracks how many conversations are being started and how long they last.
- **Messages** -- Total messages sent (both user and AI messages). Provides a measure of overall platform engagement.
- **Token Consumption** -- The number of tokens used across all LLM providers. Broken down by provider and model to help track costs.
- **Feature Adoption** -- Which platform features (chat, skills, routines, memory, integrations) are being used and by how many users. Helps identify underutilized capabilities.
- **Cost Tracking** -- Estimated costs per provider based on token consumption and model pricing. Useful for budgeting and identifying high-consumption patterns.
- **Time Range** -- All metrics accept a configurable time range specified in days. The default is 30 days.

### View the analytics dashboard

1. Go to **Settings > Analytics** (admin role required).
2. The dashboard displays summary cards for key metrics: active users, sessions created, messages sent, and tasks completed.
3. Scroll down for detailed breakdowns of token usage, feature adoption, and activity trends.

### Adjust the time range

1. On the analytics dashboard, find the time range selector.
2. Choose a preset (7 days, 30 days, 90 days) or enter a custom number of days.
3. The dashboard refreshes to show metrics for the selected period.

### Review token consumption

1. On the analytics dashboard, find the token usage section.
2. View total tokens consumed, broken down by provider (Anthropic, OpenAI, Ollama) and model.
3. Use this data to understand cost drivers and optimize model selection.

### Track feature adoption

1. On the analytics dashboard, find the feature adoption section.
2. See which features are being used: chat sessions, skill invocations, routine runs, memory operations, and integration tool calls.
3. Identify features that are underutilized and may need more team training or promotion.

### Query analytics via API

Use the analytics endpoint to retrieve metrics programmatically:

```
GET /api/v1/admin/analytics?days=30
```

The `days` query parameter controls the time range (defaults to 30). The response includes all metric categories in a single payload.

### Analytics API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/analytics?days=N` | Get usage analytics for the last N days (default: 30) |

### Analytics Tips

- Check analytics weekly to stay on top of usage trends. Sudden spikes in token consumption may indicate a misconfigured routine or an unusually active user.
- Use feature adoption data to guide onboarding. If most of your team is using chat but nobody has set up routines, that is a training opportunity.
- Token consumption is the primary cost driver. If costs are higher than expected, review which models are being used most -- switching from a larger model (e.g., Claude Opus 4.6) to a smaller one (e.g., Claude Haiku 4.5) for routine tasks can significantly reduce costs.
- The analytics API returns all metrics in a single call, making it easy to build custom dashboards or feed data into external reporting tools.
- The Settings page supports deep-linking: navigate directly with `#/settings/analytics`.

---

## Audit Logs

Comprehensive audit trail of all significant platform actions. Requires the **admin** role.

### Overview

Audit Logs record every significant action taken on the Hearth platform -- user authentication, role changes, integration connections, skill installations, governance violations, compliance scrubbing, and more. Admins can filter, search, and paginate through the log to investigate incidents, demonstrate compliance, or understand platform usage patterns. Logs are scoped to your organization and retained according to your compliance configuration.

### Key Concepts

- **Audit Event** -- A single logged action. Each event records the timestamp, the actor (user who performed the action), the action type, the entity affected, and additional details.
- **Action Types** -- The categories of events that are logged:
  - `auth_login` / `auth_register` / `auth_logout` -- Authentication events
  - `session_created` -- New chat session started
  - `task_status_change` / `task_completed` -- Task lifecycle events
  - `skill_install` / `skill_uninstall` / `skill_published` -- Skill catalog changes
  - `integration_connect` / `integration_disconnect` -- Integration lifecycle
  - `routine_run` -- Routine execution events
  - `llm_call` -- AI model invocations
  - `tool_call` -- Tool executions during conversations
  - `compliance_scrub` -- Sensitive data scrubbing events
  - `governance_violation` -- Policy violation detections
  - `governance_policy_change` -- Governance policy modifications
- **Entity Types** -- The type of object affected by an action:
  - `session`, `task`, `routine`, `skill`, `memory`, `integration`, `user`, `governance_policy`, `governance_violation`
- **Pagination** -- Results are paginated with configurable page size (default: 50 entries per page).
- **Feed-Worthy Actions** -- A subset of audit events are also emitted in real time via WebSocket to the organization room, appearing in the [Activity Feed](/guide/#activity-feed).

### View audit logs

1. Go to **Settings > Audit Logs** (admin role required).
2. The log displays a chronological list of events with timestamp, actor, action, and entity details.
3. Scroll through the list or use page controls to navigate.

### Filter audit logs

1. On the audit logs page, use the filter controls at the top.
2. Available filters:
   - **User** -- Show only events from a specific user.
   - **Action type** -- Filter by action (e.g., show only `auth_login` events or only `governance_violation` events).
   - **Entity type** -- Filter by the type of object affected (e.g., `integration`, `skill`).
3. Apply the filters. The list updates to show only matching events.

### Investigate a specific event

1. Find the event in the audit log list.
2. Click on it to expand the full details, including the `details` JSON payload with action-specific data.
3. For example, an `integration_connect` event might include the provider name and connection status, while a `compliance_scrub` event includes entity counts and pack IDs.

### Query audit logs via API

```
GET /api/v1/admin/audit-logs?userId=abc&action=auth_login&entityType=user&page=1&pageSize=50
```

All query parameters are optional. Without filters, the endpoint returns the most recent events paginated.

### Audit Logs API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/audit-logs` | Query audit logs with optional filters and pagination |

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Filter by the user who performed the action |
| `action` | string | Filter by action type (e.g., `auth_login`, `skill_install`) |
| `entityType` | string | Filter by entity type (e.g., `user`, `integration`, `skill`) |
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Results per page (default: 50) |

### Audit Logs Tips

- Use audit logs to investigate security incidents. Filter by `auth_login` to see all login attempts, or by a specific user ID to trace all their actions.
- Combine action and entity type filters for targeted searches. For example, filter by action `integration_connect` and entity type `integration` to see all integration setup events.
- Audit logs are append-only. Events cannot be modified or deleted through the application, ensuring the integrity of the trail.
- For compliance reporting, export audit data through the API. Query with date-based filters and page through all results programmatically.
- Feed-worthy audit events also appear in the real-time [Activity Feed](/guide/#activity-feed), so your team sees important actions as they happen without needing to visit the audit logs page.
- Retention of audit logs is configurable through [Compliance](#compliance) settings. Ensure your retention period meets your regulatory requirements.

---

## SSO

Single Sign-On configuration for your organization. Requires the **admin** role.

### Overview

SSO lets your team authenticate through your existing identity provider instead of managing separate Hearth credentials. Hearth supports both SAML and OIDC protocols. When SSO is configured, users are redirected to your identity provider to log in, and Hearth handles Just-In-Time (JIT) provisioning -- creating user accounts automatically on first SSO login so there is no manual account setup required.

### Key Concepts

- **SAML (Security Assertion Markup Language)** -- An XML-based protocol for exchanging authentication data between your identity provider (IdP) and Hearth. Common SAML providers include Okta, Azure AD, and OneLogin.
- **OIDC (OpenID Connect)** -- A modern JSON-based authentication protocol built on top of OAuth 2.0. Common OIDC providers include Google Workspace, Auth0, and Keycloak.
- **Identity Provider (IdP)** -- The external service that authenticates your users (e.g., Okta, Azure AD, Google Workspace). Your IdP holds the user directory and handles the actual login flow.
- **JIT Provisioning (Just-In-Time)** -- When a user logs in via SSO for the first time, Hearth automatically creates their account using the name and email from the SSO assertion. No admin needs to pre-create the account.
- **Organization Slug** -- A URL-friendly identifier for your organization (e.g., `acme-corp`). Used in the SSO check endpoint to determine whether SSO is configured for a given organization.
- **SSO Callback** -- The endpoint that receives the authentication assertion from your IdP after the user successfully logs in. Hearth validates the assertion and establishes a session.

### Configure SAML SSO

1. Go to **Settings > SSO** (admin role required).
2. Select **SAML** as the SSO type.
3. Enter the required SAML configuration from your identity provider:
   - **Entry point URL** -- The IdP's SSO login URL where users are redirected.
   - **Issuer** -- The entity ID of your IdP.
   - **Certificate** -- The IdP's public X.509 certificate for verifying SAML assertions.
4. Click **Save**. Hearth validates the required fields before saving.
5. In your identity provider, configure Hearth as a service provider:
   - **ACS URL (Assertion Consumer Service):** `https://your-hearth-domain/api/v1/auth/sso/callback`
   - **Entity ID:** Your Hearth instance URL.
   - **Name ID format:** Email address.

### Configure OIDC SSO

1. Go to **Settings > SSO** (admin role required).
2. Select **OIDC** as the SSO type.
3. Enter the required OIDC configuration:
   - **Issuer URL** -- The OIDC discovery endpoint (e.g., `https://accounts.google.com`).
   - **Client ID** -- The client ID from your OIDC provider.
   - **Client Secret** -- The client secret from your OIDC provider.
4. Click **Save**. Hearth validates the required fields before saving.
5. In your OIDC provider, configure the redirect URI as `https://your-hearth-domain/api/v1/auth/sso/callback`.

### Verify SSO is configured

Before directing users to log in via SSO, verify that SSO is configured for your organization:

```
GET /api/v1/auth/sso/check/:slug
```

The response indicates whether SSO is enabled and which protocol type (SAML or OIDC) is configured:

```json
{
  "data": {
    "enabled": true,
    "type": "saml"
  }
}
```

### Test SSO login

1. After configuring SSO, open a private/incognito browser window.
2. Navigate to your Hearth login page.
3. Enter your organization slug. If SSO is configured, you will be redirected to your identity provider.
4. Log in with your IdP credentials.
5. On success, you are redirected back to Hearth with an active session. If this is your first login, a new user account is created via JIT provisioning with the `member` role.

### Remove SSO configuration

1. Go to **Settings > SSO**.
2. Click **Remove SSO** or use the delete action.
3. Confirm the action. SSO is disabled and users must use standard Hearth authentication (email/password) to log in.

### SSO API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/sso` | Get the current SSO configuration |
| PUT | `/api/v1/admin/sso` | Save or update SSO configuration |
| DELETE | `/api/v1/admin/sso` | Remove SSO configuration |
| GET | `/api/v1/auth/sso/check/:slug` | Check if SSO is configured for an organization (public) |
| POST | `/api/v1/auth/sso/callback` | SSO callback -- handles SAML/OIDC assertion (called by IdP) |

### SSO Tips

- Test SSO in an incognito window so you do not lose your admin session if something is misconfigured.
- JIT-provisioned users are created with the `member` role by default. After their first login, an admin can promote them to `team_lead` or `admin` via the [Users & Teams](#users--teams) page.
- The organization slug must be lowercase alphanumeric with hyphens only (e.g., `acme-corp`). It is used in the SSO check endpoint and the login flow.
- SAML assertions must be cryptographically verified. Ensure the certificate you enter in the configuration matches the one your IdP uses to sign assertions.
- If SSO login fails, check the following: (1) the ACS URL in your IdP matches your Hearth instance, (2) the certificate has not expired, (3) the name ID format is set to email address.
- Removing SSO does not delete user accounts that were created via JIT provisioning. Those users continue to exist and can log in with standard credentials if set up.

---

## Cognitive Profiles

Build cognitive models from chat conversations so team members can ask "How would Sarah think about this?" and get evidence-backed responses grounded in observed thinking patterns. Requires the **admin** role to enable.

### Overview

Hearth's chat captures rich signal about how each user thinks -- the questions they ask, approaches they prefer, domains they're expert in, values they express, patterns in their decision-making. Cognitive profiles turn this ephemeral signal into a queryable model. When a coworker wants to understand how someone would approach a problem (while that person is on vacation, in a different timezone, or just busy), they type `@name` in chat and get a grounded, evidence-backed response.

The feature is **off by default** and must be explicitly enabled by an org admin. Individual users can opt out at any time.

### Key Concepts

- **Cognitive Profile** -- A synthesized summary of how a person thinks: communication style, decision-making approach, expertise areas, values, and anti-patterns. One per user per org. Rebuilt daily from accumulated thought patterns.
- **Thought Pattern** -- A single observation about how someone thinks, with evidence. Example: "When faced with a build-vs-buy decision, Sarah tends to favor building in-house, citing long-term maintenance cost concerns." Each pattern includes the category, a direct quote, a confidence score, and an observation count.
- **Pattern Categories** -- Six categories for organizing observations:
  - **decision** -- How they make choices
  - **preference** -- What they prefer or favor
  - **expertise** -- Domain knowledge and depth
  - **reaction** -- How they respond to specific situations
  - **value** -- What they prioritize and care about
  - **process** -- How they approach work and workflows
- **@mention Query** -- The interaction model. Users type `@name` in chat to ask the AI to reason from that person's perspective. The AI's response is grounded in the subject's cognitive profile and relevant thought patterns.
- **Extraction** -- After each qualifying chat session, Hearth uses a cheap model (Haiku) to extract thought patterns from the conversation. Patterns are deduplicated, reinforced on repeat observation, or superseded when contradicted.
- **Feature Gate** -- Three checkpoints ensure the feature only runs when explicitly enabled: extraction gate, query gate, and UI gate. When off, zero cognitive code runs.

### How It Works

#### Extraction pipeline

After each chat session that has 3+ user messages, Hearth analyzes the conversation to extract thought patterns. The pipeline:

1. **Gate check** -- Verify the org has cognitive profiles enabled AND the user hasn't opted out.
2. **LLM extraction** -- Send the conversation transcript to Haiku with a structured prompt. The model extracts patterns, profile updates, and contradictions.
3. **Dedup and merge** -- Each extracted pattern is embedded and compared against the user's existing patterns:
   - **Similarity > 0.85 + same category** -> reinforce (increment observation count, update confidence)
   - **Similarity > 0.85 + different category** -> supersede (mark old pattern, create new one with reason)
   - **No match** -> create new pattern
4. **Cap enforcement** -- Maximum 500 active patterns per user. Lowest-confidence patterns are evicted when the cap is exceeded.

#### Profile rebuild

A daily job (3am UTC) aggregates all non-superseded thought patterns into the cognitive profile JSON:

- Group patterns by category
- Derive expertise, values, decision style, communication style
- Weight by confidence x observation count x recency
- Single LLM call to synthesize the profile summary

#### Query path

1. User types `@sarah how would you approach migrating our monolith?` in chat.
2. Frontend resolves the `@mention` to a user ID via autocomplete.
3. Backend checks both org-level and user-level gates.
4. Loads Sarah's cognitive profile + semantic search for top-10 relevant thought patterns.
5. Injects a "Reasoning as Sarah's Perspective" section into the system prompt with the profile and patterns.
6. The agent responds through the normal chat flow -- same streaming, same UI.

#### Access control

- **Same-org only** -- Profiles are only queryable by members of the same organization.
- **No raw access** -- Coworkers never see the raw profile JSON or individual thought patterns. They only get the AI's synthesized response.
- **Audit trail** -- Every `@mention` cognitive query is logged in the audit trail with `action: cognitive_query`, so the subject can see who asked about their thinking.

### Enable cognitive profiles for your organization

1. Go to **Settings > Digital Co-Worker** (admin only).
2. Toggle **Enable cognitive profiles for this organization** to on.
3. Once enabled, Hearth begins extracting patterns from new chat sessions for all users.

::: info
Enabling the feature does not retroactively process past conversations. Pattern extraction only runs on new sessions going forward.
:::

### Query a coworker's perspective

1. In any chat session, start typing `@` followed by the person's name.
2. An autocomplete dropdown shows matching org members.
3. Select the person, then type your question. For example: `@sarah how would you approach migrating our monolith?`
4. The AI responds from that person's perspective, citing specific evidence where available.

::: tip
The AI will be honest about uncertainty. If there aren't enough thought patterns to ground a response, it will say so rather than speculate.
:::

### Opt out as an individual user

1. Go to **Settings > Profile**.
2. In the **Digital Co-Worker** section (visible only when the org feature is enabled), toggle **Allow cognitive profile for my account** to off.
3. When opted out:
   - No new patterns are extracted from your sessions.
   - Your existing patterns are excluded from query results.
   - `@mention` of your name returns a message that you've opted out.

### Disable cognitive profiles for the organization

1. Go to **Settings > Digital Co-Worker** (admin only).
2. Toggle the feature off.
3. When disabled:
   - No new patterns are extracted for any user.
   - `@mention` queries stop working (treated as normal messages).
   - Existing data is preserved but dormant.

### Cognitive Profiles API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/cognitive/settings` | Get org-level cognitive profile settings |
| PUT | `/api/v1/admin/cognitive/settings` | Update org-level settings (enable/disable) |
| GET | `/api/v1/chat/cognitive-profile/status` | Get current user's cognitive profile status |
| PUT | `/api/v1/chat/cognitive-profile/status` | Toggle current user's opt-in/out |

### Cognitive Profiles Tips

- Start by enabling the feature and letting it accumulate patterns over 1-2 weeks before using `@mention` queries. The more conversation data, the better the cognitive models.
- Cognitive profiles are most useful for capturing tacit knowledge -- the "how would X think about this" that's hard to document. They complement explicit documentation, not replace it.
- The extraction uses Haiku (the cheapest model) and runs asynchronously after sessions, so the cost impact is minimal.
- Encourage team members who want to opt out to do so -- the feature works best when participation is voluntary. Forced participation creates distrust.
- Audit the `cognitive_query` entries in your audit logs periodically to ensure the feature is being used appropriately.

---

## Decision Graph

The Decision Graph captures organizational decisions, extracts patterns, and distills principles -- building a living framework of how your organization makes decisions.

### Overview

Every organization makes thousands of decisions -- in chat, meetings, Slack threads, and email. Most are never recorded. The Decision Graph changes that by:

1. **Auto-detecting** decisions from conversations and meeting transcripts
2. **Recording** what was decided, why, by whom, and what alternatives were considered
3. **Linking** related decisions into a navigable graph
4. **Extracting patterns** from clusters of similar decisions
5. **Distilling principles** that feed back into the AI's context

### Admin Settings

Navigate to **Settings > Decision Graph** to configure:

#### Auto-Extract from Chat

When enabled, Hearth monitors conversations for decision language (e.g., "we decided to...", "let's go with...") and automatically captures decisions. High-confidence detections are saved directly; lower-confidence ones appear in the review queue for human validation.

#### Pattern Synthesis

A nightly job (2am UTC) analyzes decision clusters per domain and extracts recurring patterns. Domains with 3+ active decisions in the last 90 days are processed. Patterns progress from **emerging** (2-3 supporting decisions) to **established** (4+).

#### Principle Distillation

For domains with 3+ established patterns, an LLM distills high-level organizational principles. Principles are created with **proposed** status and require admin endorsement to become **active**. Active principles are injected into the agent's system prompt.

#### Meeting Ingestion

Meeting notes from Granola, Otter.ai, Fireflies.ai, or manual upload are processed to extract decisions. Webhooks from these providers are normalized and queued for extraction.

### Decision Lifecycle

| Status | Description |
|--------|-------------|
| `draft` | Auto-detected, needs human review |
| `active` | Confirmed and in effect |
| `superseded` | Replaced by a newer decision |
| `reversed` | Explicitly undone |
| `archived` | No longer relevant |

### Confidence Levels

| Level | Auto-capture behavior |
|-------|----------------------|
| `high` (>= 0.85) | Saved as `active` automatically |
| `medium` (0.6-0.85) | Saved as `draft`, user prompted to review |
| `low` (< 0.6) | Skipped, or agent asks "want me to capture this?" |

### Sensitivity

Decisions can be marked as:
- **normal** -- visible to all org members
- **restricted** -- visible to participants and admins
- **confidential** -- visible only to the creator and admins

### Background Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Decision Extraction | On-demand (post-session) | Extract decisions from chat conversations |
| Meeting Ingestion | On-demand (webhook/upload) | Extract decisions from meeting transcripts |
| Staleness Check | Daily at 3am UTC | Flag decisions >180 days old with no outcomes |
| Pattern Synthesis | Nightly at 2am UTC | Extract patterns and distill principles |

### Activity Feed Integration

Decision events (`decision_captured`) appear in the Activity Feed. Proactive signals alert users to stale decisions that need outcome review.
