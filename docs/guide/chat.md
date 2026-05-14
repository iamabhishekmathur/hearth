# Chat

Applies to: Hearth Cloud and self-hosted Hearth.

Chat is the primary collaborative workspace in Hearth. It combines AI conversation, real-time presence, artifacts, memory, integrations, reactions, sharing, and task creation.

[[toc]]

## Sessions

Each conversation lives in a session. Sessions can be private, shared with specific collaborators, visible to the organization, duplicated, or forked from a message.

Use sessions for:

- Live collaboration with teammates.
- Exploratory thinking with the AI.
- Producing artifacts.
- Capturing context that can later become a task.

## Sending Messages

Type a message in the composer and send it to the AI. Attach files, screenshots, images, or pasted content when the model needs more context.

When the AI works, Hearth can show:

- Streaming response text.
- Tool call cards.
- Thinking or progress indicators.
- Artifact badges.
- Task chips when work is promoted.
- Governance notices when policies apply.

## Tools and Integrations

The AI can use built-in tools and connected integration tools. Users ask naturally; Hearth decides whether a tool is useful.

Common tool-backed requests include:

| Request | What Hearth can do |
|---|---|
| "Summarize this uploaded PDF." | Extract file text and respond with a summary. |
| "Find the launch notes in Notion." | Search a connected Notion workspace. |
| "Post this recap to Slack." | Use the Slack connector after confirmation or through a routine. |
| "Create a Jira ticket for this bug." | Create an issue through the Jira connector. |
| "What do we know about this decision?" | Search memory and the decision graph. |

## Sharing and Collaboration

Hearth chat is multiplayer-first:

- Presence shows who is in the session.
- Typing and composing indicators reduce prompt collisions.
- Message attribution shows who prompted the AI.
- Reactions help teammates mark useful, confusing, or approved responses.
- Public share links can expose filtered views when enabled.
- Forking lets someone explore a new path without mutating the original session.

## Promoting Chat to Tasks

When a conversation produces follow-up work, promote a message to a task. Hearth attaches the relevant chat excerpt as context so the planning and execution agents can understand where the task came from.

Use **Backlog** when the work should be triaged later. Use **Run now** when the task should move directly into planning.

## Cognitive Queries

If cognitive profiles are enabled, users can ask how a teammate might approach a question. Hearth grounds those answers in observed patterns and respects organization-level settings and user opt-out controls.

See [Cognitive Profiles](/admin/cognitive-profiles).
