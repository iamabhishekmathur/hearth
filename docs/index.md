---
layout: home

hero:
  name: Hearth
  text: A Team AI Workspace
  tagline: A team AI workspace for chat, agent-assisted tasks, routines, activity, and company-owned context. Available in Hearth Cloud or self-hosted. BYO LLM either way.
  actions:
    - theme: brand
      text: Start with Hearth Cloud
      link: /getting-started/cloud
    - theme: brand
      text: Start self-hosted
      link: /getting-started/self-hosted
    - theme: alt
      text: Compare paths
      link: /getting-started/comparison
    - theme: alt
      text: View on GitHub
      link: https://github.com/iamabhishekmathur/hearth

features:
  - icon: "💬"
    title: Chat
    details: Teammates and agents work in one shared AI session with shared context, files, and artifacts.
    link: /guide/chat
    linkText: Learn more
  - icon: "📋"
    title: Tasks
    details: Assigned work becomes visible, planned into subtasks, executed through connected tools, and returned for approval.
    link: /guide/tasks
    linkText: Learn more
  - icon: "🔄"
    title: Routines
    details: Repeated work becomes agent-run workflows that run manually, on a schedule, or from triggers.
    link: /guide/routines
    linkText: Learn more
  - icon: "📊"
    title: Activity
    details: Teams discover what coworkers are doing in Hearth and adopt useful workflows into their own work.
    link: /guide/activity
    linkText: Learn more
  - icon: "🧠"
    title: Memory
    details: Context, decisions, outputs, and workflow history accumulate at user, team, and organization levels.
    link: /guide/memory
    linkText: Learn more
  - icon: "🛡️"
    title: Governance
    details: Admin policies, approval gates, audit trails, and sensitive-data controls keep agent execution reviewable.
    link: /admin/governance
    linkText: Learn more
  - icon: "🔌"
    title: Integrations
    details: Connect communication, meeting, work, knowledge, and GTM systems through integrations, MCP, webhooks, and APIs.
    link: /admin/integrations
    linkText: Learn more
  - icon: "🏠"
    title: Cloud or self-hosted
    details: Use Hearth Cloud for managed operations, or run the open-source core in your own infrastructure.
    link: /getting-started/comparison
    linkText: Compare paths
  - icon: "🔑"
    title: BYO LLM
    details: Bring OpenAI, Anthropic, Azure OpenAI, OpenAI-compatible providers, or OSS/local models on either path.
    link: /admin/llm-providers
    linkText: Learn more
---

## Choose Your Starting Path

Hearth can be used as a managed cloud workspace or deployed from the open-source core.

- **Hearth Cloud:** fastest path to a managed team AI workspace.
- **Self-hosted:** run Hearth in your own cloud when infrastructure ownership matters.
- **BYO LLM:** use your preferred model path with either deployment option.

## Self-Hosted Quickstart

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env        # Add your LLM API key
docker compose up
```

Open `http://localhost:3000` and complete the setup wizard.
