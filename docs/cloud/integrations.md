# Cloud Integrations

Cloud integrations give Hearth access to the tools your team already uses. Integration behavior is shared with the self-hosted product; the cloud-specific difference is that credentials are configured from a managed workspace instead of an instance you operate.

[[toc]]

## Supported Built-In Connectors

Hearth includes connector support for:

- Slack.
- Gmail.
- Google Drive.
- Google Calendar.
- Jira.
- GitHub.
- Notion.
- Custom MCP connectors where available.

See [Admin Integrations](/admin/integrations) for connector details and required credentials.

## Setup Flow

1. Open **Settings > Integrations**.
2. Choose the connector.
3. Enter the required credentials or complete the OAuth flow.
4. Test the connection.
5. Save the integration.
6. Confirm the integration appears as connected.
7. Try a low-risk action in chat or a routine.

## Rollout Order

Most teams should start with the one or two systems that create the most immediate value:

| Workflow | Useful first integrations |
|---|---|
| Meeting prep | Google Calendar, Notion, Google Drive |
| Engineering execution | GitHub, Jira, Slack |
| Support feedback | Slack, Gmail, Notion |
| Weekly leadership brief | Slack, Google Calendar, Notion |
| Task intake | Slack, Gmail, Jira |

## Credential Hygiene

- Use service accounts or scoped tokens where possible.
- Grant only the scopes the connector needs.
- Rotate credentials when owners leave the team.
- Remove integrations that are no longer used.
- Review audit logs after adding high-sensitivity integrations.

## Troubleshooting

If a connector fails:

1. Re-test the connection from **Settings > Integrations**.
2. Check whether the token expired or scopes changed.
3. Confirm the connected account still has access to the target workspace, repo, calendar, project, or document.
4. Check governance or compliance settings if an action is blocked.
5. Contact support if the integration appears healthy but tool calls fail.
