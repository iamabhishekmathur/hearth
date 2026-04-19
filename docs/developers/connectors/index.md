# MCP Connectors

Hearth integrates with external tools through the Model Context Protocol (MCP) connector system. Connectors give the agent the ability to read from and write to the services your team uses every day.

## What is MCP?

The Model Context Protocol is Hearth's abstraction layer for external tool integrations. Each connector implements a standard interface that exposes a set of tools the agent can call during task execution.

MCP decouples the agent runtime from specific service APIs. The agent doesn't know how to call the Slack API — it knows how to call a tool named `slack_send_message`. The connector handles authentication, API calls, error handling, and response formatting.

## Built-in Connectors

Hearth ships with connectors for seven services:

| Connector | Provider | Tools | Use Cases |
|---|---|---|---|
| **Slack** | `slack` | Send messages, list channels, read threads, search messages | Team communication, notifications, work intake |
| **Gmail** | `gmail` | Read inbox, send email, search messages, manage labels | Email processing, drafting replies, work intake |
| **Google Drive** | `gdrive` | List files, read documents, create files, search | Document access, report generation |
| **Jira** | `jira` | List issues, create issues, update status, add comments | Project management, task sync |
| **Notion** | `notion` | Query databases, read pages, create pages, update blocks | Knowledge base, documentation |
| **GitHub** | `github` | List repos, read issues/PRs, create issues, review PRs | Code management, issue tracking |
| **Google Calendar** | `gcalendar` | List events, create events, check availability | Meeting prep, scheduling, routine triggers |

## How Connectors Work

### The MCPConnector Interface

Every connector implements this TypeScript interface:

```typescript
interface MCPConnector {
  provider: string;
  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): ToolDefinition[];
  executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult>;
  healthCheck(): Promise<boolean>;
}

interface ConnectorConfig {
  provider: string;
  credentials: Record<string, string>;
}
```

| Method | Purpose |
|---|---|
| `connect` | Authenticate with the service using stored credentials |
| `disconnect` | Clean up connections and invalidate tokens |
| `listTools` | Return the set of tools this connector provides |
| `executeTool` | Execute a specific tool with the given input |
| `healthCheck` | Verify the connection is alive and credentials are valid |

### ConnectionManager

The `ConnectionManager` manages the lifecycle of all active connectors:

1. **Initialization** — On startup, loads configured integrations from the database
2. **Connection** — Decrypts stored credentials and calls `connect()` on each connector
3. **Health monitoring** — Periodically calls `healthCheck()` and marks unhealthy connectors
4. **Tool routing** — Routes agent tool calls to the appropriate connector via the MCP Gateway

### MCP Gateway

The MCP Gateway sits between the agent runtime and the connectors:

```
Agent Runtime
  → requests tool: "slack_send_message"
  → MCP Gateway looks up connector for "slack" provider
  → Gateway calls connector.executeTool("slack_send_message", input)
  → Connector calls Slack API
  → Result returned to agent
```

The gateway handles:
- **Tool discovery** — Aggregates tools from all connected connectors
- **Routing** — Maps tool names to the correct connector
- **Error handling** — Wraps connector errors in a standard format
- **Credential management** — Passes decrypted credentials to connectors

### Credential Storage

Integration credentials (OAuth access tokens, refresh tokens, API keys) are encrypted at rest using AES-256-GCM:

1. User completes OAuth flow for a service (e.g., Google)
2. API receives the OAuth tokens
3. Token store encrypts tokens with the `ENCRYPTION_KEY`
4. Encrypted tokens stored in the `integrations` table
5. On connector initialization, tokens are decrypted and passed to `connect()`

Tokens are never logged, never sent to the frontend, and never stored in plaintext.

## Connecting an Integration

### From the UI

1. Go to **Settings > Integrations**
2. Click **Connect** next to the service you want
3. Complete the OAuth flow (you'll be redirected to the service)
4. Once authorized, the connector status shows "Connected"

### From the API

```
POST /api/v1/integrations/slack/connect
```

The API initiates the OAuth flow and returns a redirect URL. After the user authorizes, the callback stores the tokens and establishes the connection.

## Next Steps

- [Building Custom Connectors](./building) — Create your own connector for any service
