# Memory

Applies to: Hearth Cloud and self-hosted Hearth.

Memory lets Hearth remember useful context across conversations and workflows. It is scoped so the AI can use the right context for the right person, team, or organization.

[[toc]]

## Memory Layers

| Layer | Scope | Example |
|---|---|---|
| Org | Available across the organization | "The company uses PostgreSQL and pgvector for semantic search." |
| Team | Available to a team | "Engineering ships on Tuesdays after 2pm." |
| User | Personal to one user | "Ari prefers concise answers with examples." |
| Session | Temporary context for one conversation | "This thread is about the Q2 launch plan." |

## Creating Memory

Memory can be created manually or through synthesis. Good memory entries are specific, durable, and written in third person.

Prefer:

```text
The growth team reviews launch metrics every Monday at 10am.
```

Instead of:

```text
Remember our meeting.
```

## Search and Recall

Hearth combines semantic search and scoped access rules so the AI can recall relevant entries without leaking context across inappropriate boundaries.

The Memory page lets users and admins browse, create, edit, search, and delete entries they are allowed to manage.

## Synthesis

Background synthesis can extract useful patterns from chat and work history. This helps organizational knowledge compound without requiring every useful fact to be manually saved.

Admins should pair memory synthesis with governance, compliance, audit, and retention policies that match the organization's needs.
