---
layout: home

hero:
  name: Hearth
  text: AI Productivity Platform for Teams
  tagline: Open-source, self-hosted, multiplayer-first. The models are good enough — the harness isn't.
  actions:
    - theme: brand
      text: Quickstart
      link: /getting-started/quickstart
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
    title: Chat & Artifacts
    details: Multi-session AI conversations with streaming responses, file attachments, real-time collaboration, and AI-generated artifacts in a side panel.
    link: /guide/#chat
    linkText: Learn more
  - icon: "📋"
    title: Workspace & Tasks
    details: Kanban board with automatic task detection from email, Slack, and calendar. Full lifecycle tracking with AI execution, sub-tasks, and approval gates.
    link: /guide/#workspace
    linkText: Learn more
  - icon: "🧠"
    title: Multi-Layer Memory
    details: Organization, team, and personal memory layers with vector search. Automatic synthesis distills insights across conversations and integrations over time.
    link: /guide/#memory
    linkText: Learn more
  - icon: "🔄"
    title: Routines & Automation
    details: Scheduled AI workflows with cron scheduling, templates, routine chaining, and test runs. Automate standups, reports, inbox triage, and more.
    link: /guide/#routines
    linkText: Learn more
  - icon: "🧩"
    title: Skills
    details: Browse, install, create, and import composable AI workflows. A library of skills that teach the agent specialized capabilities.
    link: /guide/#skills
    linkText: Learn more
  - icon: "🔒"
    title: Governance & Compliance
    details: Define policies that monitor every chat message. Keyword, regex, and AI-powered rules with monitor/warn/block enforcement. Violation dashboard, review workflow, trend charts, and compliance export.
    link: /platform/governance
    linkText: Learn more
  - icon: "🛡️"
    title: Self-Hosted & Secure
    details: Deploy on your infrastructure with Docker Compose or Kubernetes. AES-256-GCM encryption, SSO, audit logs, compliance controls.
    link: /self-hosting/
    linkText: Self-Hosting Guide
---

## Why Hearth?

Every AI tool today is single-player. Hearth is multiplayer by design.

Teams waste time rediscovering the same prompts, the same workflows, the same integration patterns. Hearth captures those discoveries as shared skills and memory, so the entire organization levels up together.

### Under 5 Minutes to Value

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env        # Add your LLM API key
docker compose up
```

Open `http://localhost:3000` and complete the setup wizard.

### Key Capabilities

- **Proactive Work Intake** — Monitors email, Slack, and calendar. Auto-detects tasks and prepares for upcoming meetings before you ask.
- **Approval Gates** — Configurable human-in-the-loop approvals for high-stakes actions. Review before the agent acts.
- **Sub-Agent Kanban** — All work flows through a kanban board with context control, threaded feedback, and sub-agent orchestration.
- **Memory Synthesis** — Automated 24-hour synthesis pipeline distills insights from conversations, integrations, and activity.
- **Governance Logging** — Admins define policies (keyword, regex, or AI-powered) that monitor every chat message. Three enforcement modes — monitor, warn, block — with a full violation review workflow and compliance export.
- **Provider-Agnostic** — Works with Claude, GPT, local models via Ollama, or any OpenAI-compatible endpoint.
