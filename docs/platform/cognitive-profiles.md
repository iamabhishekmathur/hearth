# Digital Co-Worker (Cognitive Profiles)

Build cognitive models from chat conversations so team members can ask "How would Sarah think about this?" and get evidence-backed responses grounded in observed thinking patterns. Requires the **admin** role to enable.

## Overview

Hearth's chat captures rich signal about how each user thinks -- the questions they ask, approaches they prefer, domains they're expert in, values they express, patterns in their decision-making. Cognitive profiles turn this ephemeral signal into a queryable model. When a coworker wants to understand how someone would approach a problem (while that person is on vacation, in a different timezone, or just busy), they type `@name` in chat and get a grounded, evidence-backed response.

The feature is **off by default** and must be explicitly enabled by an org admin. Individual users can opt out at any time.

## Key Concepts

- **Cognitive Profile** -- A synthesized summary of how a person thinks: communication style, decision-making approach, expertise areas, values, and anti-patterns. One per user per org. Rebuilt daily from accumulated thought patterns.
- **Thought Pattern** -- A single observation about how someone thinks, with evidence. Example: "When faced with a build-vs-buy decision, Sarah tends to favor building in-house, citing long-term maintenance cost concerns." Each pattern includes the category, a direct quote, a confidence score, and an observation count.
- **Pattern Categories** -- Six categories for organizing observations:
  - **decision** -- How they make choices
  - **preference** -- What they prefer or favor
  - **expertise** -- Domain knowledge and depth
  - **reaction** -- How they respond to specific situations
  - **value** -- What they prioritize and care about
  - **process** -- How they approach work and workflows
- **@mention Query** -- The interaction model. Users type `@name` in chat to ask the AI to reason from that person's perspective. The AI's response is grounded in the subject's cognitive profile and relevant thought patterns.
- **Extraction** -- After each qualifying chat session, Hearth uses a cheap model (Haiku) to extract thought patterns from the conversation. Patterns are deduplicated, reinforced on repeat observation, or superseded when contradicted.
- **Feature Gate** -- Three checkpoints ensure the feature only runs when explicitly enabled: extraction gate, query gate, and UI gate. When off, zero cognitive code runs.

## How It Works

### Extraction pipeline

After each chat session that has 3+ user messages, Hearth analyzes the conversation to extract thought patterns. The pipeline:

1. **Gate check** -- Verify the org has cognitive profiles enabled AND the user hasn't opted out.
2. **LLM extraction** -- Send the conversation transcript to Haiku with a structured prompt. The model extracts patterns, profile updates, and contradictions.
3. **Dedup and merge** -- Each extracted pattern is embedded and compared against the user's existing patterns:
   - **Similarity > 0.85 + same category** → reinforce (increment observation count, update confidence)
   - **Similarity > 0.85 + different category** → supersede (mark old pattern, create new one with reason)
   - **No match** → create new pattern
4. **Cap enforcement** -- Maximum 500 active patterns per user. Lowest-confidence patterns are evicted when the cap is exceeded.

### Profile rebuild

A daily job (3am UTC) aggregates all non-superseded thought patterns into the cognitive profile JSON:

- Group patterns by category
- Derive expertise, values, decision style, communication style
- Weight by confidence x observation count x recency
- Single LLM call to synthesize the profile summary

### Query path

1. User types `@sarah how would you approach migrating our monolith?` in chat.
2. Frontend resolves the `@mention` to a user ID via autocomplete.
3. Backend checks both org-level and user-level gates.
4. Loads Sarah's cognitive profile + semantic search for top-10 relevant thought patterns.
5. Injects a "Reasoning as Sarah's Perspective" section into the system prompt with the profile and patterns.
6. The agent responds through the normal chat flow -- same streaming, same UI.

### Access control

- **Same-org only** -- Profiles are only queryable by members of the same organization.
- **No raw access** -- Coworkers never see the raw profile JSON or individual thought patterns. They only get the AI's synthesized response.
- **Audit trail** -- Every `@mention` cognitive query is logged in the audit trail with `action: cognitive_query`, so the subject can see who asked about their thinking.

## How To

### Enable cognitive profiles for your organization

1. Go to **Settings > Digital Co-Worker** (admin only).
2. Toggle **Enable cognitive profiles for this organization** to on.
3. Once enabled, Hearth begins extracting patterns from new chat sessions for all users.

::: info
Enabling the feature does not retroactively process past conversations. Pattern extraction only runs on new sessions going forward.
:::

### Query a coworker's perspective

1. In any chat session, start typing `@` followed by the person's name.
2. An autocomplete dropdown shows matching org members.
3. Select the person, then type your question. For example: `@sarah how would you approach migrating our monolith?`
4. The AI responds from that person's perspective, citing specific evidence where available.

::: tip
The AI will be honest about uncertainty. If there aren't enough thought patterns to ground a response, it will say so rather than speculate.
:::

### Opt out as an individual user

1. Go to **Settings > Profile**.
2. In the **Digital Co-Worker** section (visible only when the org feature is enabled), toggle **Allow cognitive profile for my account** to off.
3. When opted out:
   - No new patterns are extracted from your sessions.
   - Your existing patterns are excluded from query results.
   - `@mention` of your name returns a message that you've opted out.

### Disable cognitive profiles for the organization

1. Go to **Settings > Digital Co-Worker** (admin only).
2. Toggle the feature off.
3. When disabled:
   - No new patterns are extracted for any user.
   - `@mention` queries stop working (treated as normal messages).
   - Existing data is preserved but dormant.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/cognitive/settings` | Get org-level cognitive profile settings |
| PUT | `/api/v1/admin/cognitive/settings` | Update org-level settings (enable/disable) |
| GET | `/api/v1/chat/cognitive-profile/status` | Get current user's cognitive profile status |
| PUT | `/api/v1/chat/cognitive-profile/status` | Toggle current user's opt-in/out |

## Tips

- Start by enabling the feature and letting it accumulate patterns over 1-2 weeks before using `@mention` queries. The more conversation data, the better the cognitive models.
- Cognitive profiles are most useful for capturing tacit knowledge -- the "how would X think about this" that's hard to document. They complement explicit documentation, not replace it.
- The extraction uses Haiku (the cheapest model) and runs asynchronously after sessions, so the cost impact is minimal.
- Encourage team members who want to opt out to do so -- the feature works best when participation is voluntary. Forced participation creates distrust.
- Audit the `cognitive_query` entries in your audit logs periodically to ensure the feature is being used appropriately.

## Related

- [Governance](./governance) -- Governance policies apply to all chat messages, including `@mention` cognitive queries.
- [Audit Logs](./audit-logs) -- All cognitive queries are recorded in the audit trail.
- [Soul & Identity](./soul-and-identity) -- Cognitive profiles complement identity files. SOUL.md controls how the AI behaves; cognitive profiles model how a human thinks.
