---
layout: home

hero:
  name: Hearth
  text: One AI Workspace for Your Entire Team
  tagline: Multiplayer AI chat, a task board that executes, and automated routines — self-hosted on your infrastructure with your own LLM keys.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: brand
      text: User Guide
      link: /guide/
    - theme: alt
      text: API Reference
      link: /developers/api/
    - theme: alt
      text: View on GitHub
      link: https://github.com/iamabhishekmathur/hearth

features:
  - icon: "💬"
    title: Multiplayer AI Chat
    details: The only AI chat with real-time multiplayer. Multiple people in one session. Shared artifacts everyone can see and edit. Web search, code execution, and memory recall built in.
    link: /guide/#chat
    linkText: Learn more
  - icon: "📋"
    title: Task Board
    details: Kanban board with tasks proactively generated from meetings, email, and Slack. Auto-decomposition into subtasks. The AI executes with approval gates — you review, approve, done.
    link: /guide/#tasks
    linkText: Learn more
  - icon: "🔄"
    title: Routines
    details: Cron-scheduled and webhook-triggered AI workflows. Standup summaries, metric digests, alert triage, report generation. Set up once, runs forever. Delivers to Slack, email, Jira.
    link: /guide/#routines
    linkText: Learn more
  - icon: "🧩"
    title: Skills
    details: Reusable AI workflows anyone can create and share. One person discovers a pattern, saves it as a skill, whole team benefits. The AI proposes new skills from experience.
    link: /guide/#skills
    linkText: Learn more
  - icon: "🧠"
    title: Memory
    details: "Three layers — personal, team, org — with semantic search. Daily synthesis extracts insights from conversations and integrations. The AI gets smarter for your org over time."
    link: /guide/#memory
    linkText: Learn more
  - icon: "🕸️"
    title: Decisions & Context Graph
    details: "Auto-captured from chat and meetings. Timeline view, graph view, pattern detection. The AI surfaces relevant past decisions when you're making new ones."
    link: /guide/#decisions
    linkText: Learn more
  - icon: "🤝"
    title: Cognitive Profiles
    details: "The AI learns how each person thinks. @mention a teammate: \"How would Sarah approach this?\" Responses grounded in observed patterns with cited evidence."
    link: /guide/#cognitive-profiles
    linkText: Learn more
  - icon: "📊"
    title: Activity Feed
    details: Real-time stream of what's happening across your org. React to decisions, discover workflows, and let the AI surface patterns and anomalies.
    link: /guide/#activity-feed
    linkText: Learn more
  - icon: "🔌"
    title: Integrations
    details: "Slack, email, calendar, Jira, MCP connectors, and webhooks. Bi-directional: tasks from Slack, results to Slack, routines triggered by any event."
    link: /guide/#integrations
    linkText: Learn more
  - icon: "🔑"
    title: BYO LLM
    details: Bring your own API keys. OpenAI, Anthropic, local models. Switch providers anytime. No vendor lock-in on the intelligence layer.
    link: /self-hosting/
    linkText: Self-Hosting Guide
  - icon: "🏠"
    title: Self-Hosted
    details: Deploy in your cloud or on-prem. Your data never touches our servers. Docker Compose for dev, Kubernetes + Helm for production. AGPL v3 licensed.
    link: /self-hosting/
    linkText: Self-Hosting Guide
  - icon: "🛡️"
    title: Enterprise-Ready
    details: "6 compliance packs, governance policies with monitor/warn/block, full audit trail, approval workflows, SSO + RBAC, and a violation dashboard."
    link: /platform/
    linkText: Learn more
---

## Under 5 Minutes to Value

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env        # Add your LLM API key
docker compose up
```

Open `http://localhost:3000` and complete the setup wizard.
