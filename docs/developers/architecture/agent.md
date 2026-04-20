# Agent System

The agent system is the core of Hearth's AI capabilities. It orchestrates LLM interactions, tool execution, memory retrieval, and context assembly into a streaming loop that powers chat sessions, task execution, and routine runs.

**Source files:**

- `apps/api/src/agent/agent-runtime.ts` -- The agent loop
- `apps/api/src/agent/system-prompt.ts` -- System prompt construction
- `apps/api/src/agent/tool-router.ts` -- Tool registry and execution
- `apps/api/src/agent/context-builder.ts` -- Context assembly
- `apps/api/src/agent/types.ts` -- Type definitions

## Agent Loop

The agent loop (`agentLoop` in `agent-runtime.ts`) is an async generator that yields `ChatEvent` objects as the agent streams its response. It implements a tool-use loop: the LLM generates text and/or tool calls, tools execute, results feed back into the conversation, and the loop repeats until the LLM responds without tool calls.

### Loop Steps

```
1. Filter available tools (check isAvailable() on each tool)
2. Stream LLM request (system prompt + conversation history + tool definitions)
3. Accumulate text deltas and parse tool calls as they stream
4. Execute all tool calls in parallel
5. Add assistant message + tool results to conversation history
6. Repeat from step 2
```

### Emitted Events

Each iteration of the loop yields `ChatEvent` objects to the caller:

| Event | When |
|---|---|
| `text_delta` | Each chunk of streaming text from the LLM |
| `thinking` | Extended thinking content (chain-of-thought) |
| `tool_call_start` | LLM begins a tool call (yields tool name and ID) |
| `tool_call_delta` | Streaming JSON input for a tool call |
| `tool_call_end` | Tool call input is complete |
| `tool_progress` (started) | Before each tool begins execution |
| `tool_progress` (completed/failed) | After each tool finishes, with duration |
| `error` | Fatal error; loop terminates |
| `done` | Loop complete; includes token usage stats |

### Stop Conditions

The loop terminates when any of these conditions is met:

1. **No tool calls** -- The LLM responded with text only, meaning it considers the task complete.
2. **Error** -- A streaming error from the LLM provider.
3. **Max iterations (25)** -- Safety limit to prevent runaway loops. When hit, the agent makes one final toolless LLM call asking it to summarize progress and what remains, rather than hard-erroring.

### Parallel Tool Execution

When the LLM produces multiple tool calls in a single response, all calls execute concurrently via `Promise.all`. Each tool call is timed individually, and completion/failure progress events are emitted for each.

### Default Model

The default model is `claude-sonnet-4-6`. This can be overridden per-request via `AgentContext.model` and `AgentContext.providerId`.

---

## System Prompt Construction

The system prompt (`buildSystemPrompt` in `system-prompt.ts`) is assembled dynamically for each agent invocation. The assembly order determines priority -- later sections can reference earlier ones.

### Assembly Order

```
1. Identity chain
   a. Org SOUL.md (org-wide personality and behavioral guidelines)
   b. User SOUL.md (user-specific personality overrides)
   c. User IDENTITY.md (agent's model of the user: role, preferences, working style)

2. Fallback: DEFAULT_SYSTEM_PROMPT (used when no identity docs are configured)

3. User preferences (up to 20 most recent user-layer memory entries)

4. Relevant memories (semantic search using the latest message)
   - Generates an embedding of the user's message
   - Hybrid search: vector similarity + full-text search
   - Returns up to 10 results from org/team layers (user-layer already included above)

5. Installed skills (full SKILL.md content serialized into the prompt)

6. Governance policies (when governance is enabled for the org)
   - Lists all active policies with name, severity, and description
   - Instructs the agent not to help violate these guidelines

7. Routine context (when executing a routine)
   a. Run-to-run state (persistent key-value JSON from previous runs)
   b. Previous run outputs (with optional delta-tracking flag)
   c. Trigger event details (provider, event type, actor, resource, payload)

8. Artifacts guidance (instructions for when and how to use artifacts)
```

### Default System Prompt

When no identity documents (SOUL.md / IDENTITY.md) are configured, the agent uses a built-in default prompt. Its core principles:

- **Bias toward action** -- Execute, don't explain. Skip clarifying questions unless ambiguity would cause a materially wrong action.
- **Be concise** -- No preamble. Don't narrate what you're about to do.
- **Confirm before irreversible actions** -- One-sentence confirmation for sends, deletes, and public posts. Everything else: just act.
- **Surface results, not process** -- Lead with the outcome. Optionally note what you did in one line.

The default prompt also enumerates the agent's capabilities (research, create/edit, task management, memory, integrations) and explicit boundaries (no cross-user actions, no fabricated data, no unconfirmed destructive actions).

---

## Tool Router

The tool router (`createToolRouter` in `tool-router.ts`) assembles the full set of tools available to the agent. Tools are split into built-in tools and dynamically loaded MCP tools.

### Built-in Tools

| Tool | Description |
|---|---|
| `code_execution` | Execute Python or Node.js code in an isolated Docker sandbox. Returns stdout, stderr, exit code, and duration. |
| `read_file` | Read a file from the sandbox environment. Path traversal (`..`) is rejected. Max 100KB. |
| `write_file` | Write content to a file in the sandbox. Content is base64-encoded to prevent injection. |
| `vision_analyze` | Analyze an image (URL, base64 data URI, or local upload path). Makes a separate vision LLM call. Controlled by org-level `visionEnabled` setting. |
| `save_memory` | Store information in the user's persistent memory with an optional source tag. Generates an embedding for semantic search. |
| `recall_memory` | Hybrid search (vector + full-text) across the user's accessible memory layers. |
| `web_search` | Search the web using configured search provider (Brave/Google). Returns up to N results. |
| `web_fetch` | Fetch a URL and extract readable text content (not raw HTML). Max 30K characters by default. |
| `create_artifact` | Create a persistent artifact (code, document, diagram, table, HTML, image) in the session. Emits `artifact:created` via WebSocket. |
| `update_artifact` | Update an existing artifact's content. Increments version, creates a version history entry. Emits `artifact:updated`. |
| `list_artifacts` | List all artifacts in the current session with type, title, language, and version. |
| `create_task` | Create a task on the user's Kanban board with title, description, status, and priority. |
| `update_task` | Update a task's status, title, description, or priority. Verifies ownership. |
| `list_tasks` | List the user's tasks, optionally filtered by status. |
| `get_task_context` | Retrieve the full extracted content of a task context item when the summary was truncated in the prompt. Accepts `item_id` and optional `max_length`. |
| `create_routine` | Create a scheduled routine with a cron expression and delivery config. |
| `update_routine` | Update a routine's schedule, prompt, name, or enabled state. |
| `list_routines` | List the user's routines with status and last run info. |
| `clarify` | Ask the user a structured question (multiple-choice or open-ended) when clarification is needed. |
| `session_search` | Search across the user's chat history by text content. |
| `schedule_action` | Create a one-time or recurring scheduled action (convenience wrapper over routines). |
| `delegate_task` | Spawn a sub-agent with a focused prompt and fresh context window. Returns the sub-agent's text result. |

### Routine-Only Tools

These tools are only available when the agent is executing a routine (i.e., `routineId` is set in the context):

| Tool | Description |
|---|---|
| `routine_state` | Get, set, delete, or list key-value pairs in the routine's persistent state. Enables delta tracking and deduplication across runs. |
| `set_delivery_tag` | Tag the current run output for conditional delivery routing (e.g., tag as `"critical"` to route to Slack). |

### MCP Tools

MCP (Model Context Protocol) tools are loaded dynamically from connected integrations. For each connected integration, the tool router calls `mcpGateway.listTools(integrationId)` and registers each tool with its name, description, input schema, and a handler that delegates to `mcpGateway.executeTool`.

MCP tools enable the agent to interact with external services like Slack, Gmail, Jira, GitHub, Notion, Google Calendar, and Google Drive through their respective MCP connectors.

### Tool Execution

The `executeTool` function handles:

1. **Lookup** -- Finds the tool in the map; returns a stub error if not found.
2. **Execution** -- Calls the tool's handler with the parsed input.
3. **Truncation** -- Results exceeding 50KB are truncated to prevent context window bloat. The truncated result includes `_truncated: true` and `_originalSize` metadata.
4. **Error handling** -- Catches exceptions and returns a structured error result so the LLM can react gracefully rather than crashing.

### Tool Availability

Each tool has an optional `isAvailable()` predicate. The agent loop filters out unavailable tools before sending definitions to the LLM. Examples:

- `code_execution` and `read_file` check `sandboxManager.isAvailable()` (Docker must be running).
- `vision_analyze` checks the org-level `visionEnabled` setting.

---

## Context Builder

The context builder (`buildAgentContext` in `context-builder.ts`) is the entry point for constructing a complete `AgentContext`. It queries the database for user, org, and team information, then assembles the system prompt and tool set in parallel.

### What It Assembles

| Field | Source |
|---|---|
| `userId`, `orgId`, `teamId` | Database lookup via Prisma. Org is resolved from the user's team; falls back to the first org for teamless admins. |
| `sessionId` | Passed by the caller (chat route or routine scheduler). |
| `latestMessage` | The most recent user message, used for semantic memory search in the system prompt. |
| `activeArtifactId` | The currently focused artifact in the session (optional). |
| `visionEnabled` | Read from `org.settings.llm.visionEnabled` (defaults to `true`). |
| `routineRunContext` | Optional. Includes run-to-run state, previous run outputs, and state config. Provided by `routine-context-service.ts`. |
| `triggerEvent` | Optional. The normalized webhook event that triggered a routine. |
| `routineId` | Optional. Unlocks routine-only tools (`routine_state`, `set_delivery_tag`). |
| `model` | Optional override. Defaults to `claude-sonnet-4-6` in the agent loop. |
| `providerId` | Optional. Specifies which LLM provider to use (for multi-provider setups). |
| `systemPrompt` | Built by `buildSystemPrompt()` using all the above context. |
| `tools` | Built by `createToolRouter()` including built-in and MCP tools. |

### Parallel Assembly

The system prompt and tool router are built concurrently via `Promise.all([buildSystemPrompt(...), createToolRouter(...)])` to minimize latency.

---

## AgentContext Type

```typescript
interface AgentContext {
  userId: string;
  orgId: string;
  teamId: string | null;
  sessionId: string;
  model?: string;                    // LLM model override
  providerId?: string;               // LLM provider override
  latestMessage?: string;            // for semantic memory search
  activeArtifactId?: string;         // currently focused artifact
  visionEnabled?: boolean;           // org-level vision toggle
  routineRunContext?: RoutineRunContext; // run-to-run state
  triggerEvent?: NormalizedEvent;     // webhook trigger event
  routineId?: string;                // unlocks routine-only tools
  systemPrompt: string;              // assembled system prompt
  tools: AgentTool[];                // available tools
}
```

---

## Architecture Diagram

```
User Message
     |
     v
+------------------+
| Context Builder  |  -- queries DB for user/org/team
|                  |  -- builds system prompt (identity + memory + skills + governance)
|                  |  -- assembles tool set (built-in + MCP)
+------------------+
     |
     v
+------------------+
|   Agent Loop     |  -- streams LLM request
|                  |  -- accumulates text + tool calls
|   (max 25 iter)  |  -- executes tools in parallel
|                  |  -- feeds results back to LLM
+------------------+
     |
     v
  ChatEvent stream  -->  WebSocket (agent:event)  -->  Client
```
