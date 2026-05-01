# User Guide

Everything you need to know to use Hearth.

[[toc]]

---

## Setting Up

### Completing the Setup Wizard

When you visit a fresh Hearth instance for the first time, a setup wizard walks you through initial configuration.

**Step 1 — Create your admin account.** Enter your name, email, password, and organization name.

**Step 2 — Connect an LLM provider.** Choose from:

| Provider | Models | Best for |
|----------|--------|----------|
| **Anthropic** | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | Best overall quality |
| **OpenAI** | GPT-4o, o3, o3-mini, o4-mini | Broad ecosystem |
| **Ollama** | Llama, Mistral, Qwen | Privacy-first / air-gapped |

Enter your API key (or Ollama server URL), click **Test Connection**, then select a default model.

**Step 3 — Done.** You're redirected to the main application.

> You can change the LLM provider anytime from **Settings > LLM Config**.

### Personalizing the AI

Before diving in, take two minutes to tell the AI who you are. Go to **Settings > Soul & Identity**.

**Your SOUL.md** controls how the AI communicates with you:
- Click **My SOUL.md** and write a few bullet points: preferred tone, response length, whether to include code examples, how to handle ambiguity.

**Your IDENTITY.md** tells the AI about your working context:
- Click **My IDENTITY.md** and add: your role, current projects, tools you prefer, how you like feedback.

Changes take effect immediately — no restart needed. Even 5 bullet points make a noticeable difference.

**Org SOUL.md** (admin only) sets the baseline AI personality for everyone. Individual SOUL.md files layer on top.

### Connecting Integrations

Go to **Settings > Integrations** to connect your tools:

| Service | Credentials | What it enables |
|---------|------------|-----------------|
| **Slack** | Signing secret + OAuth token | Send/read messages, search channels |
| **Gmail** | OAuth | Read/send emails, search inbox |
| **Google Drive** | OAuth | Read/create/search documents |
| **Jira** | API token + server URL | Create/update/search issues |
| **Notion** | Integration token | Read/create/update pages |
| **GitHub** | Personal access token or OAuth | Issues, PRs, code search |
| **Google Calendar** | OAuth | Read/create events, check availability |

Each integration gives the AI tools it can use during conversations and automated routines. Credentials are encrypted with AES-256-GCM.

Monitor health anytime from the same page — you'll see status, last sync time, and error details with a reconnect button if something breaks.

---

## Chat

Click **Chat** in the sidebar to open the AI conversation interface.

### Sessions and Tabs

Each conversation lives in a **session**. Sessions are listed in the sidebar and can be opened as tabs for quick switching.

- **New session** — click the **+** button in the tab bar, or just start typing.
- **Switch sessions** — click a different tab.
- **Rename** — double-click the tab title.
- **Close** — click the X on the tab. The session stays in history.
- **Delete** — right-click the tab or use the delete option in the session list.

Sessions are auto-titled after the first AI response.

### Sending Messages

Type in the compose area and press **Enter** to send. **Shift+Enter** inserts a newline.

**Attachments:** Click the paperclip icon to upload files (images, PDFs, text, JSON). Click the camera icon to capture a screenshot. Paste images directly with Ctrl/Cmd+V.

### Streaming Responses

When the AI is working, you'll see:

- A **thinking indicator** showing the AI's reasoning process
- **Tool call cards** when the AI uses tools (searching memory, running code, calling integrations)
- Response text streaming in with full Markdown rendering and syntax-highlighted code

### Available Tools

The AI has access to a set of built-in tools and any tools provided by your connected integrations. You don't invoke tools directly — just ask naturally and the AI picks the right tool.

#### Code Execution

Run Python or Node.js code in an isolated Docker sandbox. The AI can write, execute, and iterate on code.

| Try asking | What happens |
|------------|-------------|
| "Write a Python script that finds duplicate files in a directory" | Generates and runs Python code, returns results |
| "Convert this CSV data to JSON" | Writes a Node.js script to transform the data |
| "Create a bar chart of these sales numbers" | Runs Python with matplotlib, produces an image artifact |
| "Debug this function — it's returning NaN" | Executes the code, inspects output, suggests fixes |
| "Generate 100 random test users as a JSON file" | Writes and runs code, creates a downloadable file |

#### Web Search & Fetch

Search the web for current information, or fetch and read the contents of any URL.

| Try asking | What happens |
|------------|-------------|
| "What are the latest changes in React 19?" | Searches the web, summarizes findings |
| "Read this documentation page and explain the API" (paste URL) | Fetches the page, extracts text, explains it |
| "Compare pricing between AWS and GCP for a small Postgres instance" | Searches multiple sources, builds a comparison |
| "What happened in tech news today?" | Searches recent news, provides a summary |

#### Memory

Save and recall information across conversations. The AI automatically remembers things you tell it and can search for past context.

| Try asking | What happens |
|------------|-------------|
| "Remember that our deploy window is Tuesdays 2-4pm" | Saves to your personal memory |
| "What do you know about our API rate limits?" | Searches memory for relevant entries |
| "What did we discuss about the migration plan?" | Searches conversation history |

#### Task Management

Create and manage tasks on your kanban board directly from chat.

| Try asking | What happens |
|------------|-------------|
| "Create a task to update the onboarding docs" | Creates a task in Backlog |
| "What's on my board right now?" | Lists your current tasks by status |
| "Mark the deploy task as done" | Updates the task status |
| "Create a high-priority task for the security audit" | Creates a task with priority 3 |

#### Artifacts

Generate structured content that appears in the side panel with syntax highlighting, rendering, and version history.

| Try asking | What happens |
|------------|-------------|
| "Write a TypeScript service for user authentication" | Creates a code artifact with syntax highlighting |
| "Draft a project proposal for the new feature" | Creates a markdown document artifact |
| "Create a database schema diagram" | Creates a Mermaid diagram artifact |
| "Build a comparison table of these three options" | Creates a table artifact |
| "Make an interactive dashboard mockup" | Creates an HTML artifact with preview |
| "Update the auth service to add rate limiting" | Creates a new version of an existing artifact |

#### Routines & Scheduling

Set up automated tasks and reminders directly from chat.

| Try asking | What happens |
|------------|-------------|
| "Set up a daily standup summary at 9am on weekdays" | Creates a routine with cron schedule `0 9 * * 1-5` |
| "Remind me to check deploy status every hour" | Creates a recurring scheduled action |
| "What routines do I have running?" | Lists your active routines |
| "Disable the weekly report routine" | Updates the routine to disabled |

#### Vision

Analyze images, screenshots, diagrams, and photos. Available when vision is enabled in LLM config.

| Try asking | What happens |
|------------|-------------|
| "What's in this screenshot?" (attach image) | Describes the image contents in detail |
| "Is there a bug visible in this UI?" (attach screenshot) | Analyzes the screenshot and identifies issues |
| "Explain this architecture diagram" (attach image) | Reads the diagram and explains the system |

#### Delegation

For complex multi-step work, the AI can delegate subtasks to focused sub-agents that work independently and return results.

| Try asking | What happens |
|------------|-------------|
| "Research these three libraries and compare them" | Delegates focused research to a sub-agent |
| "Write tests for this module while I work on the API" | Sub-agent handles the testing independently |

#### Integration Tools (MCP)

When integrations are connected, the AI gains additional tools. These appear automatically — no configuration needed beyond connecting the integration.

| Integration | Example queries |
|-------------|----------------|
| **Slack** | "Send a summary of today's standup to #engineering" · "What's the latest in #alerts?" · "Search Slack for messages about the outage" |
| **Gmail** | "Summarize my unread emails" · "Draft a reply to the budget email" · "Find emails from Sarah about the contract" |
| **Google Drive** | "Find the Q2 planning doc" · "Create a new document with these meeting notes" · "What's in the project brief?" |
| **Jira** | "Create a bug ticket for the login issue" · "What's assigned to me this sprint?" · "Update PROJ-123 to in progress" |
| **Notion** | "Find our API documentation in Notion" · "Create a new page for the retrospective notes" · "Update the roadmap page" |
| **GitHub** | "What PRs are open on the main repo?" · "Create an issue for the memory leak" · "Search for usages of AuthService in the codebase" |
| **Google Calendar** | "What's on my calendar tomorrow?" · "Schedule a 30-min sync with the team on Friday" · "Am I free at 2pm?" |

### Artifacts

When the AI generates structured output — code, documents, diagrams, tables, or HTML — it creates an **artifact**.

- **Artifact badges** appear at the bottom of the AI's message
- Click a badge to open the **artifact panel** (slides in from the right)
- Inside the panel: copy content, download as a file, switch between artifacts, view version history
- Ask the AI to modify an artifact and it creates a new version

Artifact types: `code`, `document`, `diagram`, `table`, `html`, `image`.

### Sharing and Collaboration

Hearth chat is **multiplayer-first**: a session is a shared cognitive workspace, not a private DM with the AI.

**Visibility & access**

- **Private** (default) — only the owner sees the session.
- **Org** — any org member can find the session in their **Shared sessions** list and join.
- **Explicit collaborators** — invite specific people via the share dialog with a role: **viewer** (read-only) or **contributor** (can prompt the AI). Added users get an in-app notification.
- **Public share links** — generate a tokenised link with optional expiration and content filter (all messages, results only, template).

**Real-time presence**

- **Avatar row** at the top of the chat shows everyone currently in the session. Avatar opacity reflects state: full = active, dimmed = viewing, faint = idle.
- **Typing indicator** — "Sarah is typing…" appears above the input as soon as someone else starts.
- **Composing indicator** — for longer prompts (≥1, 50, or 200 chars), shows "Sarah is composing a prompt…" so you know they're about to send something substantial.
- **Concurrent compose warning** — if you start typing while a teammate is composing, an inline pill warns "Your prompt may interleave with theirs." Soft-warn only; you can ignore it.

**Per-message attribution**

- Every user message in a multi-author session shows the author's name + a deterministic colour avatar (eight-colour palette, hashed from user ID — same person, same colour everywhere).
- Each AI reply shows "↳ replying to [name]" so you know which prompt produced it.

**Reactions**

Hover any non-streaming message → click the ☺ icon → pick from the allowed set: 👍 👎 ✅ ❓ ⚠️ 🎯. Reactions appear as chips below the message and update live for everyone in the room.

**Unread tracking**

- A horizontal **New** divider appears on session open above the first message you haven't seen.
- Per-session **unread badges** appear on the session tab when activity arrives in a session you're not currently viewing.
- The divider auto-dismisses once you scroll to the bottom; the badge clears as you read.

**Notifications**

A bell icon in the top-right of the app shows persistent notifications for:
- Being added as a collaborator
- Tasks created from your chats (see [Promoting chat into tasks](#promoting-chat-into-tasks))
- Future: mentions, comments, governance blocks

Click any notification to jump to the relevant session/task.

**Branching**

- Hover any message → **Fork conversation from here** (git-branch icon) creates a new session forked from that point. Useful for trying alternative directions without losing the original thread.

---

## Artifacts vs Tasks: when to use which

Hearth has two ways to get work done with the AI. Choosing the right one keeps you out of the wrong tool's weak spots.

**Artifacts in chat = co-production.** You're in the room. You and the AI iterate live on a single shaped output (doc, code, diagram, table, HTML, image). The chat is your control surface. When the conversation ends, the work is done.

**Tasks on the board = delegation.** You're stepping away. The AI orchestrates multi-step work, possibly touches external systems, lands in a review gate. You come back later to approve or send it back.

### One-line heuristic

> **"Will I still be looking at this conversation when the work is done?"**
>
> Yes → artifact.  No → task.

### Decision table

| Signal | Stay in chat (artifacts) | Promote to task |
|---|:---:|:---:|
| Still figuring out what you want | ✓ | |
| You've decided; want to step away | | ✓ |
| One shaped output (doc / code / diagram) | ✓ | |
| Multi-step work, possibly subtasks | | ✓ |
| Touches external systems (Slack, PR, ticket) | | ✓ |
| Want a review gate before it ships | | ✓ |
| You'll want to find this work again next week | | ✓ (the board is your spatial memory) |
| Someone else might own the followthrough | | ✓ |
| It's recurring | _Routines_ — see [Routines](#routines) |

### The fuzzy cases

Some asks live on the boundary. "Draft a JD for staff PM" can be either: as an artifact you iterate live with the AI; as a task the agent goes off, drafts it, attaches the source chat as context, and lands in your backlog for review.

When in doubt:

- **Default to artifact** when the AI's response *is* the deliverable.
- **Promote to task** when the AI's response would say "ok, I'll need to look at X, then synthesize Y, then publish to Z" (multi-step shape).
- **Make it a routine** when you've asked for the same thing more than twice.

The AI can also propose this for you — see [AI-suggested tasks](#ai-suggested-tasks) below.

---

## Tasks

Click **Tasks** in the sidebar to open the kanban board.

### The Board

Tasks flow through six columns:

| Column | What goes here |
|--------|---------------|
| **Auto-detected** | Tasks surfaced from integrations (email, Slack, calendar). Triage these. |
| **Backlog** | Accepted tasks waiting to be planned. |
| **Planning** | Tasks being scoped — the AI may break them into sub-tasks. |
| **Executing** | Active work. The AI or a human is working on it. |
| **Review** | Completed work awaiting review or approval. |
| **Done** | Finished. |

**Creating tasks:** Click **New Task** in the top-right, type a title, press Enter. It lands in Backlog.

**Moving tasks:** Drag and drop between columns. Invalid transitions (e.g., auto_detected directly to done) are silently rejected.

**Task details:** Click any card to open the detail panel showing title, description, source, status history, sub-tasks, and AI commentary.

**Adding context:** In the detail panel, open the **Context** tab to attach rich context that the AI uses during planning and execution:

- **Notes** — Short instructions or reminders for the agent
- **Links** — Paste a URL; Hearth auto-fetches the page content
- **Files** — Upload PDFs, text files, JSON, or CSVs; text is extracted automatically
- **Images** — Upload screenshots or mockups; optionally trigger vision analysis for a description
- **Text blocks** — Paste long specs, email threads, or any reference text
- **MCP references** — Pull in Notion pages, Slack threads, or other connected integration data

You can also **drag-and-drop** files onto the context panel, or **paste** — URLs are auto-detected as links, long text becomes a text block, and clipboard files are uploaded.

Each context item shows its extraction status (Pending, Extracting, Ready, Failed). Failed extractions can be retried with the **Refresh** button. All extracted content is serialized into the agent's prompt with intelligent token budgeting — if context is too large, the agent can drill into truncated items on demand.

**Deep linking:** Append `?taskId=<id>` to the Tasks URL to open a specific task directly.

### Promoting chat into tasks

Most useful tasks start as a chat exchange. Hearth gives you three ways to move work from a conversation onto the board.

**A. The Create-task button.** Hover any non-streaming message → click the kanban icon (📋) in the action bar. A composer popover opens, pre-filled with a title derived from the message. Edit, pick **Backlog** or **Run now**, click Create.

**B. The `/task` slash command.** Type `/task` (optionally followed by a title) in the chat input → a composer slides up above the input, anchored on the latest message and pre-attached to the last 6 messages of context. Submit and it lands on the board.

**C. AI-suggested tasks.** When the AI thinks you've described task-shaped work, it can propose one inline. A card appears under its message with the proposed title, attached context preview, and Accept / Run now / Dismiss buttons. The agent picks `propose_task` (a suggestion you confirm) over `create_task` (it just does it) when intent is ambiguous — so you stay in control.

For all three paths:

- The originating chat session is recorded on the task (back-link).
- A **chat excerpt** is auto-attached as a context item — the planning + execution agents see the conversation that led to the task.
- A persistent **"✓ Task created · [title] · View →"** chip renders under the originating message. Clicking the link opens the task panel.
- A toast slides down from the top of the chat for 5 seconds with **Undo**. After the window closes, the toast disappears but the chip stays.

**Run now vs. Backlog**

- **Backlog** — the task is just stashed; the agent doesn't run yet. Use when you want to triage later.
- **Run now** — the task goes straight to **Planning**, which auto-progresses to **Executing**. The agent runs in the background; the chat stays untouched. Watch live progress on the task detail panel.

**Reverse navigation (task → chat)**

Open any task that was promoted from chat → the panel header shows **↩ From conversation: [session title]**. Clicking opens the chat session and scrolls to the originating message with a brief highlight. Chat-excerpt context items have their own **↩ Open in chat** links.

**Idempotency**

Promoting the same message twice returns the existing task. No duplicate rows, no duplicate chips.

### Work Intake

When integrations are connected, Hearth monitors them continuously:

- **Email** — detects action items and requests in your inbox
- **Slack** — picks up tasks assigned to you or your team in channels
- **Calendar** — identifies events with deliverables or preparation needed

Detected tasks appear in the **Auto-detected** column. Review them — move useful ones to Backlog, dismiss false positives. Dismissed items train the system to improve detection over time.

### Task Execution

When a task moves to **Executing**, the AI:

1. **Plans** — decomposes the task into sub-tasks if needed, using all attached context items (links, files, text blocks, etc.) with token-budgeted serialization
2. **Executes** — works through sub-tasks using tools (code execution, web search, integrations), with access to the full rich context
3. **Reports** — logs every step in the execution log, visible in the task detail panel

The agent receives a token-budgeted summary of all context items. If any item was truncated, the agent can use the `get_task_context` tool to retrieve the full content on demand.

You can watch execution in real time. If the approach is wrong, click **Replan** with feedback and the AI adjusts.

### Approvals

For high-stakes actions, the AI pauses and asks for approval before proceeding. The approval inbox shows pending requests with three options:

- **Approve** — proceed as-is
- **Reject** — cancel the action
- **Edit** — modify the output before proceeding

---

## Memory

Click **Memory** in the sidebar to open the knowledge base.

### Memory Layers

Hearth stores knowledge in three layers:

| Layer | Color | Who reads | Who writes |
|-------|-------|-----------|------------|
| **Organization** | Purple | Everyone | Admins only |
| **Team** | Blue | Team members | Admins and team leads |
| **Personal** | Green | Only you | You |

Organization memory is for company-wide decisions and standards. Team memory holds project-specific context. Personal memory stores your notes and preferences.

The AI also maintains short-term session context automatically during conversations — this is not visible in the Memory page and expires after 24 hours.

### Creating and Managing Entries

**Create:** Click **New Entry**, choose a layer, write the content, optionally add a source label, and save.

**Search:** Type a query and press Enter. Results are ranked by semantic relevance (meaning-based, not just keyword matching). A score percentage shows how closely each result matches.

**Filter:** Click the layer pills (All Layers, Organization, Team, Personal) to narrow the view.

**Edit/Delete:** Pencil and trash icons appear on entries you have write access to.

::: tip Write for the AI
State facts clearly in third person: "The team uses PostgreSQL 16 with pgvector" is more useful than "we use pg." Use the Source field consistently — months later, knowing an entry came from "Q2 planning meeting" is invaluable.
:::

### Memory Synthesis

Hearth runs a daily synthesis pipeline that automatically extracts insights from conversations, Slack messages, calendar events, and other integrations. Synthesized entries are tagged so you can distinguish them from manual entries.

The pipeline deduplicates against existing memory using embedding similarity — it won't create duplicate entries for things you already know.

---

## Routines

Click **Routines** in the sidebar to manage AI automations. Routines can run on schedules, fire from external events, maintain persistent state, accept parameters, require human approval at checkpoints, route output conditionally, and chain together into pipelines.

### Creating a Routine

1. Click **New Routine**.
2. Fill in the form:
   - **Name** — a descriptive label (e.g., "Morning Inbox Triage")
   - **Description** — what this routine does and why
   - **Prompt** — the instructions the AI follows each run. Use `{{parameter_name}}` placeholders for parameterized routines.
   - **Trigger Type** — choose Schedule (cron), Event-Only (webhook), or Both
   - **Schedule** — pick a preset (daily, weekdays, weekly) or enter a custom cron expression. Not required for event-only routines.
   - **Scope** — Personal (only you), Team (visible to your team), or Organization (visible to everyone)
3. Optionally expand the advanced sections:
   - **State & Continuity** — enable delta tracking and configure how many previous runs to inject as context
   - **Parameters** — define named parameters with types, defaults, and validation
   - **Approval Gates** — add checkpoints where the routine pauses for human review before continuing
4. Click **Create**. The routine is enabled by default.

### Templates

Click the **Templates** tab to browse pre-built routines for common workflows — daily standup summaries, weekly reports, inbox triage, meeting prep, activity digests. Click a template to pre-fill the creation form, then customize before saving.

### Running and Monitoring

- **Run Now** — trigger a routine immediately. If the routine has parameters, a form appears to enter values before execution.
- **Enable/Disable** — toggle the switch without deleting the routine
- **History** — click a routine to see all past runs with status (success/failed/running/awaiting approval), duration, token usage, and run summaries
- **Inspect** — click any run to view its full output, error details, trigger event, and parameter values

### Run-to-Run State

Routines can remember information between executions. The State tab in the routine detail panel shows the current persistent state as JSON, with a reset button to clear it.

The AI agent has access to a `routine_state` tool during execution, allowing it to get, set, and delete key-value pairs. This enables:

- **Delta reports** — only report what changed since the last run
- **Trend tracking** — accumulate metrics over time
- **Deduplication** — remember what was already processed (e.g., `last_seen_pr: 42`)

Previous run outputs are automatically injected into the system prompt (configurable via State & Continuity settings), so the AI has context about what it did before.

### Event-Driven Triggers

Routines can fire in response to external events via webhooks:

1. Go to **Webhook Endpoints** and create an endpoint for your provider (GitHub, Jira, Slack, Notion)
2. Copy the generated webhook URL and configure it in the external service
3. Add a trigger to your routine, selecting the endpoint and event type (e.g., `pull_request.opened`)
4. Optionally set filters (e.g., only for a specific repository) and parameter mapping (e.g., map the PR title to a routine parameter)

Webhook payloads are verified using provider-specific signatures, deduplicated, normalized into a common format, and injected into the agent's context.

### Parameterized Routines

Define named parameters on a routine to customize each run. Parameters have types (string, number, boolean, enum, date), labels, defaults, and required flags.

- **Scheduled runs** use default values
- **Manual runs** prompt for values via a form
- **Event-triggered runs** can map webhook payload fields to parameters
- **Chained runs** can map the source routine's output to target parameters

Use `{{parameter_name}}` in the prompt text — they're replaced with actual values before execution.

### Approval Gates

Add checkpoints where the routine pauses for human review. When the agent reaches a checkpoint, it:

1. Saves its current state
2. Creates an approval request with its output so far
3. Notifies you via in-app notification (and Slack if configured)
4. Waits for your decision: **Approve**, **Reject**, or **Edit & Approve**

Approved runs resume from where they left off. Rejected runs are marked as failed. Optional timeouts auto-resolve after a configurable period.

Pending approvals appear in the **Approvals** section of the sidebar.

### Conditional Delivery

By default, routine output is delivered to in-app notifications. With delivery rules, you can route output to different channels based on content:

- **Condition types** — always, contains keyword, does not contain keyword, agent-tagged
- **Channels** — in-app, Slack, email, Notion, Jira
- **Templates** — customize the message format per channel using `{{output}}` placeholders

The agent can also tag its output (e.g., tag as "critical") using the `set_delivery_tag` tool, and delivery rules can match on these tags.

### Routine Chains

Link routines together into multi-step pipelines:

1. Open a routine's detail panel
2. In the **Chains** section, click "Then trigger" and select a target routine
3. Choose a condition: **On success**, **On failure**, or **Always**
4. Optionally configure parameter mapping to pass data between routines

The system prevents circular chains (validated via cycle detection). Pipeline execution is tracked so you can see the full chain of runs in sequence.

### Scoping

Routines can be scoped to **Personal**, **Team**, or **Organization** level. Use the scope tabs at the top of the routines list:

| Scope | Who can view | Who can edit | Credentials |
|-------|-------------|-------------|-------------|
| Personal | Owner | Owner | Owner's |
| Team | Same team | Admin / team lead | Creator's |
| Organization | Everyone | Admin only | Creator's |

The creator's credentials are always used for execution, regardless of who triggers a run.

### Routine Health (Admin)

Admins can monitor all routines across the organization from **Settings > Routine Health**:

- **Dashboard** — summary cards showing total runs, average success rate, and total token consumption
- **Per-routine health** — success rate, average duration, token usage, and last run time for each routine
- **Health alerts** — configure alerts for consecutive failures, missed schedules, or high token usage. Alerts are checked every 15 minutes and delivered via in-app notification.

---

## Skills

Click **Skills** in the sidebar to browse and manage AI capabilities.

### Browsing Skills

Three tabs organize the skill library:

- **All** — every available skill, searchable by name or description
- **Installed** — skills you've added to your agent
- **Recommended** — AI-generated suggestions based on your usage patterns, with relevance scores

### Installing and Uninstalling

Click any skill card to open its detail panel with full description and usage info. Click **Install** to add it to your agent. The agent automatically selects which installed skills to apply based on conversation context — no manual invocation needed.

Uninstall from the same detail panel. Skills are scoped to your user account; installing doesn't affect others.

### Creating Custom Skills

Click **Create Skill** to write a new skill with a name, description, and content. Skills use the [SKILL.md format](/developers/skill-format).

### Importing from GitHub

Click **Import** and paste a GitHub repository URL containing a skill definition. Hearth fetches a preview — review and confirm to add it to the library.

### Skill Proposals

After complex tasks, the AI may propose new skills based on patterns it observed. Proposals appear in the skills list for review. Admins govern which skills are approved organization-wide.

---

## Activity Feed

Click **Activity** in the sidebar to see a real-time stream of everything happening across your organization.

### Events

The feed shows task completions, skill publications, skill installations, routine execution results, and new session creations — grouped by time: **Today**, **Yesterday**, **This Week**, **Older**.

When three or more events of the same type occur in a time bucket, they collapse into an expandable group.

### Filtering and Reacting

**Filter** by clicking the pills at the top: All, Tasks, Skills, Installs, Routines, Sessions.

**React** by hovering over any event and clicking the emoji picker. Reactions sync in real time across all connected users.

### Proactive Signals

AI-generated signals appear at the top of the feed — patterns, anomalies, or opportunities the system has detected. Dismiss them individually; dismissing doesn't affect other users.

---

## Decision Graph

The Decision Graph is your organization's decision memory — capturing what was decided, why, by whom, and what happened after. Navigate to **Decisions** in the left sidebar.

### Browsing Decisions

The Decisions page has four tabs:

- **Timeline** — Chronological list grouped by time buckets (Today, This Week, etc.). Click any decision to open the detail panel.
- **Graph** — Visual graph showing how decisions relate to each other. Nodes are colored by domain and sized by connection count.
- **Patterns** — Recurring patterns extracted from clusters of similar decisions. Patterns progress from "emerging" to "established" as more supporting decisions are identified.
- **Principles** — High-level organizational principles distilled from established patterns. Each principle includes a guideline (what to do) and anti-pattern (what not to do).

Use the **Domain** filter to focus on a specific area (engineering, product, hiring, etc.).

### Capturing Decisions

There are three ways to capture decisions:

1. **In chat** — The AI detects decision language and uses the `capture_decision` tool automatically. You can also ask: "Capture the decision we just made."
2. **Manual capture** — Click "Capture Decision" on the Decisions page. Fill in the title, reasoning, domain, and optional fields.
3. **Meeting ingestion** — Upload meeting transcripts or connect Granola/Otter.ai/Fireflies.ai webhooks. Decisions are extracted automatically.

### Review Queue

When auto-detection has low confidence, decisions are saved as drafts. A yellow banner on the Decisions page shows how many decisions need review. Click **Approve** to confirm or **Dismiss** to discard false positives.

### Recording Outcomes

Click any decision to open the detail panel, then click **+ Record Outcome** to document what happened. Choose a verdict (positive, negative, mixed, neutral, too early) and describe the result. Outcomes help the system learn which types of decisions lead to good results.

### Decision in Chat

When the AI surfaces a decision in chat, it appears as a teal badge. Click the badge to navigate to the decision in the graph. The agent also proactively surfaces relevant past decisions when you're discussing topics that relate to previous decisions — helping you make more informed choices.

### How Auto-Detection Works

1. **Fast filter** — Regex patterns match decision language ("we decided", "let's go with", "agreed to")
2. **LLM classification** — If the fast filter fires, a lightweight LLM call confirms whether a real decision is present
3. **Structured extraction** — The LLM extracts title, reasoning, alternatives, stakeholders, and domain
4. **Dedup check** — Embedding similarity prevents duplicate decisions (cosine > 0.90 = merge)
5. **Auto-link** — Similar existing decisions are automatically linked (cosine > 0.75)

---

## Administration

::: info Admin role required
The features in this section require the **admin** role.
:::

### Users and Teams

Go to **Settings > Users** to create accounts, assign roles, and deactivate users. Three roles:

| Role | Can do |
|------|--------|
| **Admin** | Full platform control, all settings |
| **Team Lead** | Manage own team, team-level memory |
| **Member** | Standard access |

Go to **Settings > Teams** to create teams, assign members, and designate team leads.

### LLM Configuration

Go to **Settings > LLM Config** to change providers, update API keys, test connections, and select default models. You can store keys for multiple providers and switch between them without changing workflows.

### Governance

Go to **Settings > Governance** to define organizational policies that monitor chat messages for compliance violations. Governance helps teams operating under HIPAA, SOC2, or internal IP policies.

**Settings** — toggle governance monitoring on/off, choose whether to check user messages, AI responses, or both. Enable a monitoring banner so users know policies are active.

**Policies** — create rules that detect prohibited content:

| Rule Type | How it works | Best for |
|-----------|-------------|----------|
| **Keyword** | Match comma-separated words/phrases | Specific terms: "password", "SSN", competitor names |
| **Regex** | Match a regular expression pattern | Structured data: credit card numbers, SSN patterns |
| **LLM Evaluation** | AI evaluates each message against a natural language prompt | Nuanced rules: "Is this sharing customer PII?" |

Each policy has three enforcement modes:

| Mode | Behavior |
|------|----------|
| **Monitor** | Log the violation silently for admin review |
| **Warn** | Log the violation and show a warning to the user in chat |
| **Block** | Prevent the message from reaching the AI (returns 403) |

**Violations** — view all detected violations with filters for severity (info/warning/critical) and status (open/acknowledged/dismissed/escalated). Click a violation to expand details: full content snippet, match data, and a link to the chat session. Review actions:

- **Acknowledge** — mark as reviewed
- **Dismiss** — mark as false positive
- **Escalate** — flag for further action (requires a note)

**Statistics** — summary cards showing total violations, open count, and severity breakdown. A 30-day trend chart shows violation patterns over time.

**Export** — download violations as CSV or JSON for compliance auditing. Includes timestamps, user details, policy names, match data, and review history.

**System prompt injection** — when governance is enabled, active policy descriptions are automatically injected into the AI's system prompt. This makes the AI proactively avoid violations before they happen.

> Start with **monitor** mode to understand what would be flagged, then graduate to **warn** or **block** once you've tuned your rules.

See the full [Governance guide](/platform/#governance) for API reference and advanced configuration.

### Compliance Packs

Go to **Settings > Compliance** to enable automatic scrubbing of sensitive data before it reaches external LLM providers. This is critical for teams in regulated industries (healthcare, finance, education).

**How it works:** When compliance packs are enabled, Hearth detects sensitive entities in your messages (SSNs, credit card numbers, medical records, etc.) and replaces them with placeholders like `[SSN_1]` before sending to the LLM. The AI's response is then de-scrubbed so you see the original values. The LLM never sees your sensitive data.

**Six built-in packs:**

| Pack | Best for | Key detectors |
|------|----------|---------------|
| **PII** | All teams | SSN, email, phone, names, addresses, DOB |
| **PCI-DSS** | Payment processing | Credit cards (Luhn-validated), CVV, expiry |
| **PHI** | Healthcare (extends PII) | Medical records, health plan IDs, medications |
| **GDPR** | EU operations (extends PII) | IBANs, EU VAT, EU national IDs, EU phones |
| **FERPA** | Education | Student IDs, grades/GPA, enrollment info |
| **Financial** | Finance/accounting | Account numbers, routing numbers (ABA-validated), amounts |

**Quick setup:** Enable the packs relevant to your industry, use the built-in test panel to verify detection on sample text, then save. Changes take effect immediately.

**Per-detector overrides** let you disable specific detectors within an enabled pack (e.g., allow emails through while still scrubbing SSNs).

See the full [Compliance guide](/platform/#compliance) for pack details, architecture, and API reference.

### Digital Co-Worker (Cognitive Profiles)

Go to **Settings > Digital Co-Worker** to enable cognitive profiles for your organization. When enabled, Hearth builds cognitive models from chat conversations so team members can ask "How would X think about this?"

**How it works:** After each qualifying chat session, Hearth extracts thought patterns -- observations about how the user reasons, decides, and communicates. Over time, these patterns build into a cognitive profile that captures communication style, decision-making approach, expertise areas, and values.

**Querying a coworker's perspective:** In any chat, type `@name` to trigger the autocomplete. Select a team member and ask your question:

| Example query | What the AI does |
|---|---|
| `@sarah how would you approach this migration?` | Searches Sarah's thought patterns, loads her profile, responds from her perspective with cited evidence |
| `@david what concerns would you have about this design?` | Grounds the response in David's observed values and decision patterns |

**Key details:**

- **Off by default** -- must be explicitly enabled by an org admin
- **Individual opt-out** -- users can disable their cognitive profile from **Settings > Profile**
- **Audit trail** -- every `@mention` query is logged so the subject can see who asked
- **Same-org only** -- profiles are never visible across organizations
- **No raw access** -- coworkers only see the AI's synthesized response, never raw patterns or profile data

> The more conversations Hearth processes, the better the cognitive models become. Allow 1-2 weeks of normal usage before relying on `@mention` queries.

See the full [Digital Co-Worker guide](/platform/#digital-co-worker-cognitive-profiles) for API reference and configuration details.

### Audit Logs

View a complete trail of all platform actions in **Settings > Audit Logs**, filterable by user, action type, and entity. Compliance scrubbing events appear under the `compliance_scrub` action type with entity counts and pack details. Cognitive profile queries appear under the `cognitive_query` action type.

### Analytics

Go to **Settings > Analytics** to view usage metrics: active users, sessions created, messages sent, tasks completed, token consumption, and feature adoption rates. Configurable time range (default 30 days).
