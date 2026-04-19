# Quickstart

Get Hearth running locally in under 5 minutes. By the end of this guide, you'll have a working instance with an AI chat session ready to go.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose installed
- An LLM API key from one of: [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or a running [Ollama](https://ollama.ai/) instance

## Steps

### 1. Clone and configure

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env
```

Open `.env` and add your LLM API key. At minimum, set one of:

```bash
ANTHROPIC_API_KEY=sk-ant-...    # For Claude models
OPENAI_API_KEY=sk-...           # For GPT models
OLLAMA_BASE_URL=http://...      # For local models
```

### 2. Start all services

```bash
docker compose up
```

This starts PostgreSQL (with pgvector), Redis, the API server, the worker, and the web frontend. First run takes a few minutes to build.

### 3. Complete the setup wizard

Open [http://localhost:3000](http://localhost:3000). The setup wizard walks you through:

1. **Create admin account** — Set your name, email, password, and organization name.
2. **Connect LLM provider** — Select your provider, enter your API key, test the connection, and choose a default model.
3. **Done** — You're redirected to the main app.

See [First Run](/getting-started/first-run) for a detailed walkthrough of each wizard step.

### 4. Start your first chat

Click **Chat** in the sidebar. Type a message and press Enter. The AI responds with streaming text, and may generate artifacts (code, documents, diagrams) that appear in the side panel.

## What's next?

- **[User Guide](/guide/)** — Learn all Hearth features: chat, workspace, routines, memory, skills, and more.
- **[Connect integrations](/platform/integrations)** — Link Slack, Gmail, Jira, GitHub, and other tools.
- **[Configure your identity](/platform/soul-and-identity)** — Personalize how the AI communicates with you.
- **[Set up routines](/guide/#chat)** — Automate recurring tasks like daily standups and inbox triage.
- **[Self-hosting guide](/self-hosting/)** — Production deployment with Kubernetes, TLS, and monitoring.
