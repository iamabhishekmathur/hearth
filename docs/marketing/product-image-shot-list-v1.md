# Hearth Product Image Shot List v1

Status: Draft for approval  
Purpose: Define the product images needed for the landing page, README, Product Hunt gallery, social posts, and founder demos.

## Creative Principle

Every image should prove one thing:

> Hearth turns useful individual AI work into shared team capability.

Avoid generic dashboard screenshots. Each image should show the product doing a specific job in the story: capture, organize, reuse, remember, govern.

## Recommended Shot Set

### 1. Hero: The Breakthrough Session

Primary claim:

> One teammate's AI breakthrough becomes visible, shared, and reusable.

Use on:

- Landing page hero
- README first screen
- Product Hunt first gallery image
- Social launch post

Product route:

- `/#/chat`
- Session: `Enterprise Beta Launch Review`

Frame:

- Show the chat thread with the AI synthesis visible.
- Include enough of the left session rail to show this is a workspace, not a standalone chatbot.
- Ideally show the assistant response with blockers, risks, tasks, decisions, and saved workflow language.

Suggested overlay/caption:

> From one AI session to a reusable team workflow.

Why it matters:

- This is the emotional hook.
- It makes the product understandable before people know every feature.
- It proves Hearth is not just "chat with admin controls."

Capture notes:

- Avoid showing a blank input state.
- Avoid tiny text; crop tighter around the useful assistant output.
- If possible, show collaborators/presence so the product feels multiplayer.

### 2. Workflow Loop: Chat To Tasks To Reuse

Primary claim:

> Hearth captures the work and turns it into an operating loop.

Use on:

- Landing page "How it works" section
- Product Hunt gallery
- Investor/founder explanation deck later

Product routes:

- `/#/chat`
- `/#/workspace`
- `/#/skills`
- `/#/routines`

Frame:

- A composed product image with 3-4 panels:
  - Chat: launch review synthesis
  - Workspace: task board populated from the session
  - Skills: Enterprise Launch Review
  - Routines: Monday Launch Risk Digest

Suggested overlay/caption:

> Capture what works. Turn it into a workflow. Let the team reuse it.

Why it matters:

- This explains the full product loop without forcing users to read a feature list.
- Strongest website section after the hero.

Capture notes:

- This can be a designed composite, not a raw screenshot.
- Keep the UI panels large enough to read titles.
- Do not cram in every feature.

### 3. Workspace: AI Follow-Up Becomes Owned Work

Primary claim:

> AI conversations create follow-up your team can actually execute.

Use on:

- Landing page product proof section
- Social clip/post about "AI creates tasks from context"
- README screenshot

Product route:

- `/#/workspace`

Frame:

- Show the Kanban board with all columns visible if possible.
- Feature the launch tasks:
  - `Implement audit-log export for admins`
  - `Fix SSO callback retry handling`
  - `Review launch decision memo`
  - `Summarize enterprise security FAQ for procurement`

Suggested overlay/caption:

> The follow-up leaves the chat and lands where the team works.

Why it matters:

- This is the bridge from "AI chat" to "team operating system."
- Team leads and operators will care.

Capture notes:

- If the board is too wide, use a horizontal crop or designed composite.
- Avoid empty space; make task titles readable.

### 4. Skills: The Power User's Workflow Becomes Reusable

Primary claim:

> Your best AI workflows become reusable team assets.

Use on:

- Landing page section about AI power users
- Product Hunt gallery
- Founder social post

Product route:

- `/#/skills`

Frame:

- Show `Enterprise Launch Review` as the hero item.
- Include supporting skills:
  - `Security FAQ Builder`
  - `Launch Decision Memo`
- If available, show install counts or installed state.

Suggested overlay/caption:

> Make your AI power users' breakthroughs your team's starting point.

Why it matters:

- This is the core positioning in product form.
- It speaks directly to the first user/champion.

Capture notes:

- This screen needs to feel like a library of working patterns, not an app marketplace.
- Consider opening the detail panel for `Enterprise Launch Review` if the list alone feels too static.

### 5. Activity: Workflows Spread Across The Team

Primary claim:

> Useful AI work becomes discoverable across the organization.

Use on:

- Landing page teamwork/social proof section
- Social post about team adoption
- Product Hunt gallery

Product route:

- `/#/activity`

Frame:

- Show proactive/trending workflow cards near the top.
- Include activity events:
  - skill published
  - skill installed
  - routine run
  - decision captured
  - governance violation

Suggested overlay/caption:

> When one teammate finds what works, everyone can see it.

Why it matters:

- This makes the product feel alive and multiplayer.
- It shows internal distribution: Hearth is not just a private productivity tool.

Capture notes:

- Activity can get visually busy; crop around the strongest cards/events.
- Prefer a few readable events over a full feed.

### 6. Memory: The Company Keeps The Context

Primary claim:

> Your organization's AI memory should belong to your organization.

Use on:

- Landing page memory ownership section
- README trust section
- CTO/IT social post

Product route:

- `/#/memory`

Frame:

- Show org/team memory entries from the launch story:
  - enterprise customers require SSO/audit logs/data-retention answers
  - launch reviews should use Enterprise Launch Review
  - audit-log exports should include tool-call metadata

Suggested overlay/caption:

> Your company's AI memory should not live inside OpenAI or Anthropic.

Why it matters:

- This speaks to CTOs, founders, and AI governance buyers.
- It differentiates from ChatGPT/Claude team accounts.

Capture notes:

- Make sure the screenshot does not feel like a generic notes database.
- Pair memory with a caption about org-owned context.

### 7. Decisions: The Rationale Does Not Disappear

Primary claim:

> Decisions, rationale, alternatives, and outcomes become organizational knowledge.

Use on:

- Landing page memory/decision section
- README deeper product proof
- Enterprise sales/support material later

Product route:

- `/#/decisions`

Frame:

- Show decision timeline entries:
  - `Gate enterprise beta expansion on SSO callback reliability`
  - `Require audit-log export before enterprise procurement calls`
  - `Include tool-call metadata in audit-log exports`

Suggested overlay/caption:

> The decision graph remembers why the team chose the path.

Why it matters:

- Strong proof for leaders who worry about knowledge loss.
- Makes "memory" more concrete than generic chat history.

Capture notes:

- A detail panel may be more compelling than the timeline alone if it shows reasoning and alternatives clearly.

### 8. Compliance: The Third Path Between Shadow AI And Lockdown

Primary claim:

> Govern AI adoption without blocking the people already creating value.

Use on:

- Landing page governance section
- CTO/InfoSec outreach
- Product Hunt gallery
- README trust/security section

Product route:

- `/#/settings/compliance`

Frame:

- Show enabled compliance packs:
  - PII
  - PCI-DSS
  - GDPR
- Include scrubbing stats if possible:
  - total operations
  - entities scrubbed
  - pack usage

Suggested overlay/caption:

> Self-hosted governance for real AI usage.

Why it matters:

- This resolves the buyer objection.
- It positions Hearth between shadow AI and AI lockdown.

Capture notes:

- The current orange enabled state is demo-ready.
- Capture both enabled packs and stats if one frame allows; otherwise use a composed image.

### 9. Open Source / Self-Hosted Trust Image

Primary claim:

> Teams can own the workflow layer, memory layer, and deployment model.

Use on:

- Landing page trust section
- GitHub README
- Product Hunt gallery

Product route/source:

- Landing page/docs/GitHub/architecture graphic

Frame:

- Could be a simple architecture image rather than a product screenshot:
  - Hearth workspace
  - Postgres/pgvector memory
  - Redis/worker
  - LLM providers: OpenAI, Anthropic, Azure/local
  - Integrations: Slack, GitHub, Notion, Gmail/Calendar

Suggested overlay/caption:

> Open source. Self-hosted. Bring your own models.

Why it matters:

- GitHub and technical buyers need trust quickly.
- Helps separate Hearth from closed SaaS AI workspaces.

Capture notes:

- This should be polished and simple.
- Do not lead with architecture on the landing page; use it lower down for trust.

## Priority Order

1. Hero: The Breakthrough Session
2. Workflow Loop: Chat To Tasks To Reuse
3. Skills: The Power User's Workflow Becomes Reusable
4. Compliance: The Third Path Between Shadow AI And Lockdown
5. Workspace: AI Follow-Up Becomes Owned Work
6. Memory: The Company Keeps The Context
7. Activity: Workflows Spread Across The Team
8. Decisions: The Rationale Does Not Disappear
9. Open Source / Self-Hosted Trust Image

## Landing Page Placement

Recommended mapping:

- Hero: Shot 1
- "When one teammate finds a better way..." section: Shot 2
- Product loop: Shots 3, 4, 5
- Memory ownership: Shots 6 and 7
- Governance: Shot 8
- Open source/self-hosted: Shot 9

## Approval Questions

- Should the hero visual be a raw product screenshot, or a designed composite using real product UI?
- Should we use captions/overlays in the website images, or keep text outside the screenshots?
- Should Product Hunt images be more editorial than the landing page images?
- Do we want to show real provider names, especially OpenAI and Anthropic, inside the memory/governance image?
