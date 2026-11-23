# Integrations

Applies to: Hearth Cloud and self-hosted Hearth.

Integrations connect Hearth to external systems through built-in connectors and MCP-backed tools.

[[toc]]

## Supported Connectors

Hearth includes connector support for:

- Slack.
- Gmail.
- Google Drive.
- Google Calendar.
- Jira.
- GitHub.
- Notion.
- Custom MCP connectors.

## What Integrations Enable

Connected tools let Hearth:

- Search team context.
- Read documents, issues, messages, and events.
- Create or update tickets, messages, pages, and calendar events.
- Trigger routines from external events.
- Deliver routine outputs to team channels.
- Attach external context to tasks.

## Setup Flow

1. Open **Settings > Integrations**.
2. Choose a provider.
3. Enter the required credentials or complete OAuth.
4. Test the connection.
5. Save the connector.
6. Confirm it appears as connected.

## Personal and Organization Connections

Members can connect their own Slack, Gmail, or Granola from **Tools**. Only they can see and disconnect those.

Connections an admin sets up in **Settings > Integrations** belong to the organization. Members see them on the **Tools** page under **Shared by your organization**, but only admins can check or disconnect them.

## Connection Health

Hearth re-checks every active connection about every five minutes and records the result.

- **Healthy**: the last check, within the past hour, succeeded.
- **Connected**: connected, but not checked in the past hour (for example, right after Hearth restarts).
- **Error**: the last check failed. Reconnect or update the credentials.

Click **Check** on a connection to re-check it immediately.
7. Try one low-risk action from chat or a routine.

## Credential Handling

Integration tokens are encrypted before storage. Admins should still use scoped credentials, rotate them regularly, and remove unused connectors.

For self-hosted deployments, the `ENCRYPTION_KEY` controls encryption of stored integration credentials. See [Secrets](/self-hosting/secrets).

## Cloud Notes

In Hearth Cloud, integration credentials are configured at the workspace level. Review [Cloud Security and Data](/cloud/security-and-data) before connecting highly sensitive systems.

## API Reference

See [Admin Endpoints](/developers/api/admin) and [MCP Connectors](/developers/connectors/).
