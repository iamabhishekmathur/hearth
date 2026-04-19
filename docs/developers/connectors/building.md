# Building Custom Connectors

This guide walks through creating a new MCP connector for Hearth. A connector wraps an external service's API and exposes it as a set of tools the agent can call.

## Prerequisites

- Familiarity with TypeScript and async/await
- API documentation for the service you're integrating
- OAuth credentials or API key for the target service

## Connector Anatomy

A connector is a TypeScript class that implements the `MCPConnector` interface:

```typescript
import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { MCPConnector, ConnectorConfig } from './base-connector.js';

export class MyServiceConnector implements MCPConnector {
  provider = 'my-service';
  private client: MyServiceClient | null = null;

  async connect(config: ConnectorConfig): Promise<void> {
    // Initialize the API client with credentials
    this.client = new MyServiceClient({
      accessToken: config.credentials.access_token,
    });
  }

  async disconnect(): Promise<void> {
    // Clean up connections
    this.client = null;
  }

  listTools(): ToolDefinition[] {
    // Return the tools this connector provides
    return [
      {
        name: 'my_service_list_items',
        description: 'List items from My Service',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of items to return',
            },
          },
        },
      },
      {
        name: 'my_service_create_item',
        description: 'Create a new item in My Service',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Item title',
            },
            content: {
              type: 'string',
              description: 'Item content',
            },
          },
          required: ['title'],
        },
      },
    ];
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!this.client) {
      return { success: false, error: 'Not connected' };
    }

    switch (toolName) {
      case 'my_service_list_items':
        return this.listItems(input);
      case 'my_service_create_item':
        return this.createItem(input);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Make a lightweight API call to verify connectivity
      if (!this.client) return false;
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  // Private methods for each tool
  private async listItems(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const limit = (input.limit as number) || 10;
    const items = await this.client!.items.list({ limit });
    return {
      success: true,
      data: items.map((item) => ({
        id: item.id,
        title: item.title,
        created: item.createdAt,
      })),
    };
  }

  private async createItem(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const item = await this.client!.items.create({
      title: input.title as string,
      content: (input.content as string) || '',
    });
    return {
      success: true,
      data: { id: item.id, title: item.title },
    };
  }
}
```

## Interface Methods

### connect(config)

Called when the integration is activated. Receives decrypted credentials. Initialize your API client here.

- **Do:** Validate credentials are present, create the API client
- **Don't:** Make API calls — save that for `healthCheck`

### disconnect()

Called when the user disconnects the integration. Clean up any resources.

### listTools()

Return an array of tool definitions. Each tool has:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique tool name. Convention: `{provider}_{action}` (e.g., `slack_send_message`) |
| `description` | `string` | What the tool does. The agent reads this to decide when to use the tool. |
| `inputSchema` | `object` | JSON Schema describing the tool's parameters. |

### executeTool(toolName, input)

Execute a tool call. The `input` object matches the `inputSchema` you defined. Return a `ToolResult`:

```typescript
// Success
{ success: true, data: { /* any serializable object */ } }

// Failure
{ success: false, error: 'Human-readable error message' }
```

### healthCheck()

Return `true` if the connection is alive and credentials are valid. Called periodically by the ConnectionManager.

## Tool Definitions

### Naming Convention

Tool names follow the pattern `{provider}_{verb}_{noun}`:

```
slack_send_message
gmail_search_messages
jira_create_issue
gdrive_list_files
```

### Input Schema

Use JSON Schema to define parameters. The agent uses the schema to construct valid tool calls:

```typescript
{
  name: 'jira_create_issue',
  description: 'Create a new Jira issue in the specified project',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Jira project key (e.g., "ENG")',
      },
      title: {
        type: 'string',
        description: 'Issue title/summary',
      },
      type: {
        type: 'string',
        enum: ['bug', 'task', 'story', 'epic'],
        description: 'Issue type',
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Issue priority',
      },
      description: {
        type: 'string',
        description: 'Detailed issue description (markdown)',
      },
    },
    required: ['project', 'title', 'type'],
  },
}
```

Write clear descriptions for each property — the agent uses them to understand what values to provide.

## Testing Your Connector

Write unit tests that mock the external API:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MyServiceConnector } from './my-service-connector.js';

describe('MyServiceConnector', () => {
  it('lists tools', () => {
    const connector = new MyServiceConnector();
    const tools = connector.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('my_service_list_items');
  });

  it('executes list_items tool', async () => {
    const connector = new MyServiceConnector();
    await connector.connect({
      provider: 'my-service',
      credentials: { access_token: 'test-token' },
    });

    const result = await connector.executeTool(
      'my_service_list_items',
      { limit: 5 },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('returns error for unknown tool', async () => {
    const connector = new MyServiceConnector();
    const result = await connector.executeTool('unknown_tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('health check returns false when not connected', async () => {
    const connector = new MyServiceConnector();
    const healthy = await connector.healthCheck();
    expect(healthy).toBe(false);
  });
});
```

## Registration

Register your connector in the ConnectionManager so it can be discovered and initialized:

```typescript
// apps/api/src/mcp/connection-manager.ts
import { MyServiceConnector } from './connectors/my-service-connector.js';

// In the connector registry
const connectorRegistry: Record<string, () => MCPConnector> = {
  slack: () => new SlackConnector(),
  gmail: () => new GmailConnector(),
  // ... other connectors
  'my-service': () => new MyServiceConnector(),
};
```

## Submission Checklist

Before submitting a new connector:

- [ ] Implements all five `MCPConnector` methods
- [ ] Tool names follow `{provider}_{verb}_{noun}` convention
- [ ] All tools have clear descriptions and complete input schemas
- [ ] `executeTool` handles unknown tool names gracefully
- [ ] `healthCheck` works without side effects
- [ ] Unit tests cover all tools and error paths
- [ ] No credentials logged or exposed in error messages
- [ ] API rate limits respected (add backoff if needed)
- [ ] Connector registered in ConnectionManager
