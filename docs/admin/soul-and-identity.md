# Soul and Identity

Applies to: Hearth Cloud and self-hosted Hearth.

Soul and Identity controls how Hearth speaks and what it knows about a person or organization before a conversation starts.

[[toc]]

## Documents

| Document | Scope | Purpose |
|---|---|---|
| Org SOUL.md | Organization | Sets the baseline tone, values, and behavior for the assistant across the workspace. |
| User SOUL.md | Individual user | Adds personal communication preferences on top of the org baseline. |
| User IDENTITY.md | Individual user | Describes the user's role, projects, responsibilities, tools, and working context. |

## How Prompt Context Is Built

Hearth layers identity context before each interaction:

1. Organization SOUL.md.
2. User SOUL.md.
3. User IDENTITY.md.
4. Relevant memory, task context, decisions, skills, and integration context.

The goal is not to create a rigid persona. It is to give the AI enough stable context to communicate usefully without every user repeating preferences in every prompt.

## Admin Setup

Admins should create a short org-level SOUL.md before inviting the whole team. Keep it practical:

- Preferred tone.
- How much detail the AI should provide.
- How the AI should handle uncertainty.
- Security or compliance reminders.
- Team communication norms.
- Formatting preferences for common work.

## User Setup

Users should fill in their own SOUL.md and IDENTITY.md:

- Role and responsibilities.
- Current projects.
- Preferred communication style.
- Tools and systems they use.
- How they like feedback.
- Anything the assistant should avoid assuming.

## Good Defaults

Good identity docs are specific, short, and easy to update. Avoid long policy documents that bury the details the assistant needs in daily work.

## Related Docs

- [Memory](/guide/memory)
- [Cognitive Profiles](/admin/cognitive-profiles)
- [LLM Providers](/admin/llm-providers)
