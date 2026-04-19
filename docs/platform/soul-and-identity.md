# Soul & Identity

Personalize how the AI communicates and what it knows about you using markdown documents.

## Overview

Soul & Identity is Hearth's personalization system. It uses two types of markdown documents -- SOUL.md and IDENTITY.md -- to shape every AI interaction. SOUL.md controls how the AI communicates (tone, style, behavior), while IDENTITY.md tells the AI what it should know about you (role, expertise, preferences). Documents exist at both org and user levels, letting organizations set a baseline personality while individuals layer on personal preferences.

## Key Concepts

- **SOUL.md** -- Defines the AI's personality, tone, and communication style. Think of it as "how the agent should talk." Examples: preferred tone (direct, friendly, formal), response length preferences, whether to include code examples by default, how to handle uncertainty.
- **IDENTITY.md** -- Documents your working context, role, and preferences. Think of it as "what the agent should know about you." Examples: your role and expertise, current projects, tools and frameworks you prefer, how you like feedback.
- **Three document levels:**
  - **Org SOUL.md** (admin only) -- Organization-wide baseline personality. Sets the default tone and behavior for all users.
  - **User SOUL.md** -- Personal communication preferences that layer on top of the org baseline. Any user can edit their own.
  - **User IDENTITY.md** -- Your personal working context. Any user can edit their own.
- **System prompt construction** -- The AI reads all applicable documents before every interaction. The org SOUL.md is loaded first, then the user's SOUL.md and IDENTITY.md are layered on top. This happens automatically via the context builder.
- **Immediate effect** -- Changes to any document take effect on the very next message. No restart or refresh is needed.

## How To

### View your profile

1. Go to **Settings > Profile**.
2. Your name, email, and role are displayed. These fields reflect your account as set up by your admin.

### Define your AI personality (SOUL.md)

1. Go to **Settings > Soul & Identity**.
2. Click the **My SOUL.md** pill at the top of the editor.
3. Write markdown describing how you want the AI to communicate with you. For example:
   - Preferred tone (direct, friendly, formal)
   - Response length preferences (concise bullet points vs. detailed explanations)
   - Whether to include code examples by default
   - How to handle uncertainty or ambiguity
4. Click **Save**.
5. The agent reads this document and adjusts its responses accordingly.

### Document your working style (IDENTITY.md)

1. Go to **Settings > Soul & Identity**.
2. Click the **My IDENTITY.md** pill at the top of the editor.
3. Write markdown describing yourself and your work context. For example:
   - Your role and areas of expertise
   - Projects you are currently working on
   - Tools and frameworks you prefer
   - How you like to receive feedback
   - Working hours and timezone
4. Click **Save**.
5. The agent uses this to provide more relevant, personalized responses.

### Set the organization AI personality (admin only)

1. Go to **Settings > Soul & Identity**.
2. Click the **Org SOUL.md** pill (visible only to admins).
3. Write markdown defining the organization-wide AI personality. This sets the baseline tone and behavior for all users.
4. Click **Save**.
5. Individual users' SOUL.md files layer on top of this, so personal preferences can override or extend the org defaults.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/identity/:level/:fileType` | Get a document (level: `org` or `user`, fileType: `soul` or `identity`) |
| PUT | `/api/v1/identity/:level/:fileType` | Create or update a document (body: `{ content: "..." }`) |

The `level` parameter determines scope:
- `org` -- Organization-wide document. Only admins can write org-level documents.
- `user` -- Personal document. Any authenticated user can read and write their own.

The `fileType` parameter selects the document type:
- `soul` -- Communication style and personality.
- `identity` -- Working context and preferences.

## Tips

- Start with your SOUL.md to set communication preferences, then add IDENTITY.md for deeper personalization. Even a few bullet points make a noticeable difference.
- The agent reads both documents before every response. Changes take effect immediately after saving -- no restart needed.
- The Org SOUL.md is a good place to encode team norms: "Always cite sources," "Use metric units," "Default to TypeScript examples," "Respond in Spanish," etc.
- You can use full markdown syntax in both documents, including headers, lists, code blocks, and emphasis.
- Keep documents focused. A concise SOUL.md with clear preferences (5-15 bullet points) works better than a lengthy essay.
- IDENTITY.md is especially powerful when it includes current context: "I'm working on the billing migration this sprint" helps the AI give you relevant answers without being asked.
- Settings supports deep-linking via URL hash. Navigate directly to the identity editor with `#/settings/identity`.

## Related

- [Chat](/guide/#chat) -- The AI applies your Soul & Identity documents in every chat conversation.
- [Users & Teams](./users-and-teams) -- Admins manage the accounts that own these documents.
- [Routines](/guide/#chat) -- Routines also read your identity documents when generating automated outputs.
- [LLM Config](./llm-config) -- The AI model powering responses is configured separately from personality.
