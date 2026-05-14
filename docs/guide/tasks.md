# Tasks

Applies to: Hearth Cloud and self-hosted Hearth.

Tasks are Hearth's delegation surface. They move work out of chat and onto a board where the agent can plan, execute, ask for review, and replan when needed.

[[toc]]

## Board Columns

| Column | What happens |
|---|---|
| Auto-detected | Hearth surfaced possible work from connected systems. |
| Backlog | Accepted work waiting to be planned. |
| Planning | The planning agent is decomposing the task. |
| Executing | The agent or a human is working through the plan. |
| Review | Completed work is waiting for human approval. |
| Done | The task is complete. |
| Failed | The task needs attention or replanning. |

## Creating Tasks

Tasks can come from:

- Manual creation on the board.
- Promotion from a chat message.
- Promotion from an artifact.
- AI-suggested task cards.
- Proactive work intake from integrations.
- Subtasks created during planning.

## Rich Task Context

Context items tell the agent what it needs before planning or execution.

Supported context includes:

- Notes.
- Links with fetched content.
- Uploaded PDFs, text files, JSON, CSV, and other documents.
- Images and screenshots with optional vision analysis.
- Text blocks.
- MCP references from connected tools such as Notion pages or Slack threads.
- Chat excerpts and artifacts promoted from a session.

Hearth extracts context asynchronously and serializes useful portions into the agent prompt. Large context can be searched or drilled into by tools.

## Planning and Execution

When a task moves to **Planning**, Hearth enqueues the planning agent. The planner can create subtasks and execution steps, then advance the task to **Executing**.

During execution, progress appears in the task detail panel. Users can inspect steps, comments, outputs, and failures.

## Review and Replanning

When work reaches **Review**, a human can approve it or request changes. Requested changes send feedback back into planning so the next run has reviewer context.

Use **Replan** when the current plan is wrong, stale, or incomplete.

## Work Intake

With integrations connected, Hearth can detect potential tasks from Slack, email, meetings, and related work streams. These land in **Auto-detected** for human triage before becoming planned work.
