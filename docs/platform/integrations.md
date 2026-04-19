# Integrations

Integrations connect Hearth to external tools via MCP (Model Context Protocol). Each connected service gives the AI tools it can use during conversations and routines.

## Overview

Hearth supports seven pre-built connectors: Slack, Gmail, Google Drive, Jira, Notion, GitHub, and Google Calendar. Each connector provides a set of tools the AI can call -- sending Slack messages, creating Jira tickets, searching Google Drive documents, and more. Admins configure integrations by providing credentials, which are encrypted with AES-256-GCM before storage and never logged or exposed in plaintext.

## Key Concepts

- **MCP (Model Context Protocol)** -- The standard protocol Hearth uses to communicate with external services. Each integration is an MCP connector that exposes tools the AI can call.
- **Connector** -- A pre-built adapter for a specific service (Slack, GitHub, etc.). Each connector defines the tools it provides and the credentials it requires.
- **Connection Status** -- Each integration reports one of three states: **connected** (working normally), **disconnected** (no credentials configured), or **error** (credentials invalid or service unreachable).
- **Health Check** -- Hearth periodically verifies that connected integrations are still working. The last check time and any error details are displayed on each connector card.
- **Credential Encryption** -- All integration tokens and API keys are encrypted with AES-256-GCM before being stored in the database. They are never displayed in full after being saved.

## Supported Connectors

### Slack

- **Provider key:** `slack`
- **Credentials:** Signing secret + OAuth bot token (`xoxb-...`)
- **Tools:** Send messages to channels or users, read channel history, search conversations, list channels
- **Use cases:** Post routine summaries, notify teammates, surface Slack context in chat

### Gmail

- **Provider key:** `gmail`
- **Credentials:** OAuth access token (`ya29...`)
- **Tools:** Read emails and threads, send emails, search inbox, manage labels
- **Use cases:** Summarize unread emails, draft replies, find emails related to a topic

### Google Drive

- **Provider key:** `gdrive`
- **Credentials:** OAuth access token (`ya29...`)
- **Tools:** Read documents, create new documents, search files by name or content
- **Use cases:** Find reference documents, create meeting notes, search for specs

### Jira

- **Provider key:** `jira`
- **Credentials:** Jira domain URL, email address, and API token
- **Tools:** Create issues, update issue status, search issues with JQL, manage sprints
- **Use cases:** Create tickets from chat, look up issue status, update sprint boards

### Notion

- **Provider key:** `notion`
- **Credentials:** Integration token (`ntn_...`)
- **Tools:** Read pages and databases, create new pages, update existing pages, query databases
- **Use cases:** Look up documentation, create meeting notes, update project trackers

### GitHub

- **Provider key:** `github`
- **Credentials:** Personal access token (`ghp_...`) or OAuth token
- **Tools:** Read and create issues, read and create pull requests, search code, list repositories
- **Use cases:** Create issues from conversations, check PR status, search codebase

### Google Calendar

- **Provider key:** `gcalendar`
- **Credentials:** OAuth access token (`ya29...`)
- **Tools:** Read events, create new events, check availability, list upcoming meetings
- **Use cases:** Check schedule before booking, create events from chat, surface meeting context

## How To

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

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/integrations` | List all integrations and their status |
| POST | `/api/v1/admin/integrations` | Add a new integration |
| PATCH | `/api/v1/admin/integrations/:id` | Update integration credentials or settings |
| DELETE | `/api/v1/admin/integrations/:id` | Remove an integration |
| GET | `/api/v1/admin/integrations/:id/health` | Check health status of a specific integration |

## Tips

- Only admins can manage integrations, but all users benefit from connected services during AI conversations. The AI automatically uses available integration tools when relevant.
- Start with the integrations your team uses most. The AI only offers tool actions for connected services, so connecting Slack and Jira first means the AI can immediately help with communication and issue tracking.
- If an integration shows an error status, the most common cause is an expired token. OAuth tokens for Google services (Gmail, Drive, Calendar) need periodic refresh.
- Hearth health-checks integrations automatically. You can see the last checked time on each connector card to verify they are being monitored.
- Credentials are encrypted at rest with AES-256-GCM. After saving, only a masked preview is shown. The raw token cannot be retrieved.
- For Jira, you need three pieces of information: your Jira domain (e.g., `yourteam.atlassian.net`), the email address associated with your Atlassian account, and an API token generated from your Atlassian account settings.
- The Settings page supports deep-linking: navigate directly with `#/settings/integrations`.

## Related

- [Work Intake](/guide/#work-intake) -- Integrations feed external events into the work intake pipeline.
- [Routines](/guide/#chat) -- Routines can trigger actions through connected integrations (e.g., posting a daily summary to Slack).
- [LLM Config](./llm-config) -- Configure the AI providers that power conversations where integration tools are used.
- [Activity Feed](/guide/#activity-feed) -- Actions taken through integrations appear in the activity feed.
