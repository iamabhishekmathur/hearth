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

## History and Owners

Hearth keeps every version of an org, team or personal memory entry. Session notes are not kept. An owner can restore an earlier version; Hearth saves the restore as a new version.

Owners follow the layer: admins own org memory, admins and team leads own their team's memory, and each person owns their own memory. An admin can also name one more owner for an org or team entry.

## How Hearth Learns From Gaps

Hearth notices, in the background, when the AI may be missing something: a search of memory that finds nothing, a thumbs-down, a regenerate, a person correcting the AI, or an owner editing a routine's output before approving it. Nothing changes in your chat, and these notes are never shown to other members.

Hearth removes secrets and personal data such as emails and phone numbers before it saves a note, keeps at most 500 characters, and deletes notes after 90 days.

When the knowledge loop is on for your organization, a nightly curator turns these notes into proposed fixes. Owners approve, edit or reject them in the [Review Inbox](/guide/review). Nothing changes until an owner approves.

## Synthesis

Background synthesis can extract useful patterns from chat and work history. This helps organizational knowledge compound without requiring every useful fact to be manually saved.

Admins should pair memory synthesis with governance, compliance, audit, and retention policies that match the organization's needs.
