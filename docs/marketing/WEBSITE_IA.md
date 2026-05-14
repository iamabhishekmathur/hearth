# Hearth Website Information Architecture

Status: Working plan  
Last updated: 2026-05-02  
Purpose: Make the public website explain Hearth clearly, support launch assets, and give content marketing somewhere coherent to live.

## 1. Strategic Job Of The Website

The website needs to answer five questions in order:

1. What is Hearth?
2. How would my team actually use it?
3. Why is this better than everyone using AI in private tabs?
4. Can my company trust, govern, and own this?
5. What should I do next?

The hero now answers the first question:

> An AI workspace that finds, plans, and finishes your team's work.

Everything below the hero should now support that proactive-work story. The older "shared workflows" story is still important, but it should be framed as the result of work getting captured, approved, and reused.

## 2. Current Site Diagnosis

Current routes:

- `/` Homepage
- `/product`
- `/pricing`
- `/self-host`
- `/security`
- `/changelog`
- External docs at `https://docs.hearth-app.xyz`

Current homepage sequence:

1. Hero
2. Workspace
3. Workflow Loop
4. Problem
5. Shift
6. Cloud / self-host
7. Product System
8. Ownership
9. Governance
10. Audience
11. Final CTA

Main issue:

The hero has moved to proactive work completion, but the sections underneath still mostly explain the older narrative: shared AI work, reusable workflows, and AI power-user breakthroughs. Those are useful, but they no longer carry the main story by themselves.

Specific issues:

- The homepage should answer "how will I use this?" immediately after the hero.
- The Product section says "Three surfaces" even though the positioning bible now defines six surfaces: Chat, Tasks, Routines, Skills, Discovery Feed, Institutional Memory.
- The Problem and Shift sections are now too abstract and should be rewritten around missed follow-up, scattered context, uneven AI usage, and work that does not get finished.
- Cloud/self-host appears before the product story is fully understood.
- Audience comes too late and is too broad.
- There is no blog or resource hub, even though the GTM plan depends on content marketing, newsletters, podcasts, creator outreach, Product Hunt, Hacker News, and social distribution.
- Footer lacks future social/community surfaces and launch-resource links.

## 3. Recommended Top Navigation

Primary nav should stay simple:

- Product
- Use Cases
- Resources
- Pricing
- Docs

Secondary or dropdown items:

- Security
- Self-host
- Blog
- Changelog
- GitHub

CTA:

- Start free

Rationale:

Product explains what Hearth is. Use Cases answers "is this for me?" Resources catches blog, guides, launch assets, media kit, comparisons, and founder story content. Pricing and Docs are high-intent actions.

## 4. Recommended Homepage Story

### 1. Hero

Job:

Say the category and promise in one sentence, then show the product loop above the fold.

Keep:

- H1: "An AI workspace that finds, plans, and finishes your team's work."
- Subhead about conversations, meetings, emails, and team activity becoming owner-assigned tasks, proactive routines, and reusable workflows.
- Proof cards: Finds work, Plans the path, Finishes with approval.
- Product mockup showing chat -> tasks -> review -> routines -> activity.

Improve later:

- Replace illustrative mock with real product screenshot or polished HTML demo after the first wow workflow is locked.
- Add "Watch 60-sec demo" once the final product video exists.

### 2. How Teams Use Hearth

Job:

Immediately answer "how will I use this?"

Recommended message:

> Four ways your team uses Hearth every week.

Cards or interactive tabs:

- Collaborative AI sessions: work with teammates and AI in the same room.
- Agent-planned tasks: Hearth identifies work, breaks it into subtasks, and returns output for approval.
- Proactive routines: recurring workflows run on a schedule, trigger, or command.
- Discovery Feed: find teammates' workflows and add them to your own.

This should be product-forward with screenshots or HTML mockups, not abstract benefit cards.

### 3. The Work Loop

Job:

Show the mechanics behind the promise.

Recommended sequence:

1. Detect: Hearth notices follow-up or repeated work from Slack, Gmail, meetings, docs, and tools.
2. Plan: Hearth creates owner-assigned tasks and subtasks.
3. Execute: agents use connected tools and context to do allowed work.
4. Approve: humans review, replan, approve, reject, or mark complete.
5. Reuse: useful work becomes a skill, routine, or workflow others can add.
6. Remember: context, decisions, and audit history become institutional memory.

This should replace the current generic "Work together. Save what works. Run it again." section.

### 4. The Problem

Job:

Make the pain recognizable.

Recommended message:

> Your team has AI access. That does not mean AI is doing the work.

Three concrete pains:

- Follow-up lives across Slack, Gmail, meetings, and docs.
- A few people build powerful AI workflows while everyone else starts from blank chat.
- Useful context and decisions disappear into individual accounts and vendor histories.

Avoid:

- Abstract "compounding leverage" language.
- Over-indexing on private chat histories as the only problem.

### 5. The Shift

Job:

Show the transformation.

Recommended message:

> Work stops depending on who knows the best prompt.

Before / after:

- Before: "Can someone send me the prompt?"
- After: "Hearth found the workflow. Add it to my work."
- Before: "Who owns the follow-up?"
- After: "The task is assigned, planned, and ready for approval."
- Before: "Where did that decision go?"
- After: "It is in institutional memory with source context."

### 6. Persona Use Cases

Job:

Create the wow moment for each ICP and support SEO/content paths.

Use cases to feature:

- Sales: after a call, Hearth finds objections, drafts the reply, updates CRM, and creates next steps.
- Product: Hearth clusters customer feedback and creates product tasks.
- Engineering: Hearth gathers GitHub, Slack, docs, and incident context into an investigation plan.
- Marketing: Hearth turns a launch doc into checklist, posts, website tasks, and Product Hunt prep.
- Operations / Chief of Staff: Hearth turns leadership meetings into owners, tasks, recap, and weekly follow-up.
- Customer Success / Support: Hearth clusters repeated support issues, drafts replies, and creates documentation tasks.

This can be a homepage section plus a dedicated `/use-cases` route later.

### 7. Trust, Governance, And Ownership

Job:

Make the exec / CTO / CISO case.

Recommended message:

> The third path between shadow AI and AI lockdown.

Include:

- Hearth Cloud for speed and convenience.
- Open-source self-hosted Hearth for maximum control.
- Bring your own model.
- Company-owned institutional memory.
- Audit-friendly activity.
- Human approval gates.
- Guardrails for PII, PCI, HIPAA-sensitive workflows without claiming formal compliance unless verified.

### 8. Open Source And Deployment

Job:

Make GitHub and self-hosting feel like a first-class path.

Include:

- GitHub CTA.
- Quickstart CTA.
- Self-host docs CTA.
- Cloud vs self-host split.
- Honest deployment-readiness note until "under 5 minutes to value" is verified.

### 9. Resources / Blog Preview

Job:

Set up the site for content marketing.

Recommended message:

> Guides on proactive AI work, governed adoption, and team workflows.

Show three latest or featured pieces:

- Founder POV / AI adoption essay.
- Tactical playbook / use case.
- Technical or self-hosting guide.

### 10. Final CTA

Job:

Give two clear next steps.

Recommended CTAs:

- Start free
- Self-host Hearth

Secondary links:

- Watch demo
- Read docs
- View GitHub

## 5. Recommended Routes

### `/`

Homepage. The main narrative and conversion path.

### `/product`

Job:

Deeper product explanation.

Recommended sections:

- Product hero: "How Hearth helps your team finish work with AI."
- Six surfaces: Chat, Tasks, Routines, Skills, Discovery Feed, Institutional Memory.
- Work loop: detect, plan, execute, approve, reuse, remember.
- Product screenshots or HTML demos.
- Integrations and tools.
- CTA to start free / self-host.

### `/use-cases`

Job:

Persona-specific wow workflows.

Initial pages or anchors:

- `/use-cases/sales`
- `/use-cases/product`
- `/use-cases/engineering`
- `/use-cases/marketing`
- `/use-cases/operations`
- `/use-cases/support`

Start as one page with sections, then split if content grows.

### `/pricing`

Job:

Explain Cloud plans and the self-hosting alternative.

Keep:

- Plan cards.
- Cloud vs self-host split.
- FAQ.

Improve:

- Make "open-source self-hosted remains available" impossible to miss.
- Explain what paid cloud adds: hosted ops, limits, support, SSO/audit on higher plans.

### `/self-host`

Job:

Developer / CTO gateway for the open-source path.

Improve:

- Be precise about quickstart readiness.
- Link architecture, deployment, environment variables, and security docs.
- Avoid leaning on "under 5 minutes" until verified.

### `/security`

Job:

Trust page for CTO, CISO, IT, and enterprise buyers.

Improve:

- Frame as governed AI adoption, not generic security.
- Keep current controls factual.
- Add explicit claim guardrails: no HIPAA/PCI compliance claim until verified.
- Explain institutional memory, audit logs, approval gates, and deployment choice.

### `/blog`

Job:

Content marketing hub.

Recommended categories:

- AI Workflows
- Proactive Agents
- Team AI Adoption
- Shadow AI And Governance
- Institutional Memory
- Open Source / Self-hosting
- Product Updates

Recommended launch posts:

1. "Your team has AI access. Why is only one person getting faster?"
2. "The next phase of AI at work is not chat. It is completed work."
3. "The third path between shadow AI and AI lockdown."
4. "Why your company's AI memory should not live inside OpenAI or Anthropic."
5. "How Hearth turns a sales call into follow-up, CRM updates, and reusable routines."
6. "Cloud for speed, self-hosted for control: why Hearth supports both."

### `/resources`

Job:

House non-blog GTM assets.

Initial resources:

- Product video.
- Product screenshots.
- Media kit.
- One-page product brief.
- Founder story.
- Architecture one-pager.
- Security/self-hosting FAQ.
- Comparison sheets.
- Product Hunt gallery.

This can start as a footer-only route or wait until assets exist.

### `/compare`

Job:

Handle alternative evaluation.

Potential comparisons:

- ChatGPT / Claude.
- Slack.
- Notion / project management tools.
- Zapier / n8n / automation tools.
- Prompt management tools.

Do not launch this until the positioning is stable enough to avoid sounding defensive.

### `/changelog`

Job:

Open-source and product momentum proof.

Keep, but remove from top nav. Put in footer and resources.

## 6. Footer IA

Recommended footer columns:

Product:

- Product
- Use Cases
- Pricing
- Security
- Changelog

Developers:

- Docs
- API
- Self-host
- GitHub
- Contributing

Resources:

- Blog
- Product video
- Media kit
- Guides
- Comparisons

Company:

- Contact
- Status
- Sign in
- Start free

Social:

- GitHub
- X
- LinkedIn
- YouTube or Loom channel
- Discord or community if used
- RSS
- Product Hunt after launch

## 7. GTM Artifact Map

The GTM todo implies these website surfaces:

- Product video: homepage hero secondary CTA, resources page, Product Hunt page.
- Product images: homepage product sections, product page, README, Product Hunt gallery, social cards.
- Logo/icon/social assets: nav, footer, favicons, X, LinkedIn, Product Hunt.
- GitHub README: self-host page and footer should drive to GitHub.
- Docs: top nav and developer footer should drive to docs.
- X and LinkedIn: footer links and future blog distribution.
- Product Hunt: launch badge/link after launch.
- Hacker News: technical architecture, limitations, self-hosting, and README must be easy to find.
- Podcasts/newsletters/creator outreach: media kit, product brief, founder story, and demo video need a resources home.
- Early adopter outreach: use-case pages, one-page product brief, security/self-hosting FAQ, and pilot CTA.
- Sales/pilot materials: resources page or gated/not-public sales kit later.

## 8. Implementation Order

Recommended next steps:

1. Rewrite homepage sections under the hero around the proactive work loop.
2. Update `/product` to explain the six product surfaces and work loop.
3. Add `/blog` with a simple content data structure and 3-6 launch post placeholders.
4. Update nav and footer to include Use Cases, Resources/Blog, GitHub, X, LinkedIn, and Docs.
5. Add `/use-cases` as one page with six persona workflows.
6. Update `/security` copy around governed AI adoption and claim guardrails.
7. Update `/self-host` around Cloud vs self-host and honest quickstart readiness.
8. Add resources/media-kit page once video, images, and product brief exist.
9. Refresh GTM_TODO so it matches the new H1 and website IA.

