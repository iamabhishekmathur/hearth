# Artifacts

Applies to: Hearth Cloud and self-hosted Hearth.

Artifacts are structured outputs created during chat. They let a conversation produce something durable: code, documents, diagrams, tables, HTML, or images.

[[toc]]

## When to Use Artifacts

Use an artifact when the AI's response is the deliverable and you plan to stay in the conversation while iterating.

Good artifact requests:

- Draft a project proposal.
- Write a TypeScript service.
- Create a Mermaid system diagram.
- Build a comparison table.
- Make an HTML prototype.
- Revise this document with the new constraints.

## Artifact Panel

Artifacts appear as badges under AI messages. Open an artifact to view, copy, download, or revise it. When you ask for changes, Hearth creates a new version so the work remains traceable.

## Artifacts vs Tasks

Hearth has two paths for work:

| Signal | Use an artifact | Use a task |
|---|---:|---:|
| The response itself is the deliverable | Yes | No |
| You are still shaping the output live | Yes | No |
| The work has multiple steps and external actions | No | Yes |
| You want the agent to leave chat and report back | No | Yes |
| You need a review gate before completion | Usually no | Yes |
| The work should recur | No | Use a routine |

One useful question: will you still be looking at this conversation when the work is done? If yes, use an artifact. If no, promote it to a task.

## Promote an Artifact to a Task

If an artifact becomes a starting point for follow-up work, promote it to a task. Hearth attaches the artifact as task context so the agent can reference it during planning and execution.
