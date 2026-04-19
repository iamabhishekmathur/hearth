# Developers

Technical reference for building on and extending Hearth.

## API Reference

Hearth exposes a REST API at `/api/v1/` with WebSocket support via Socket.io.

- **[API Overview](/developers/api/)** — Authentication, error handling, rate limiting, and conventions.
- **[Chat & Sessions](/developers/api/chat)** — Create sessions, send messages, manage artifacts and attachments.
- **[Tasks](/developers/api/tasks)** — Task CRUD, status transitions, execution, and comments.
- **[Memory](/developers/api/memory)** — Memory entry CRUD and semantic search.
- **[Skills](/developers/api/skills)** — Skill discovery, installation, creation, and recommendations.
- **[Routines](/developers/api/routines)** — Routine CRUD, execution, chains, and templates.
- **[Activity](/developers/api/activity)** — Activity feed, reactions, and proactive signals.
- **[Artifacts](/developers/api/artifacts)** — Artifact CRUD and version history.
- **[Approvals](/developers/api/approvals)** — Approval requests and resolution.
- **[Admin](/developers/api/admin)** — User, team, integration, LLM, governance, and compliance management.
- **[Webhooks & Uploads](/developers/api/webhooks)** — Webhook ingestion and file upload endpoints.

## Real-Time

- **[WebSocket Events](/developers/websocket-events)** — Full reference for all Socket.io events: chat streaming, presence, artifacts, activity, and more.

## Architecture

- **[System Overview](/developers/architecture/)** — High-level architecture, technology decisions, and data flow.
- **[Agent System](/developers/architecture/agent)** — Agent loop, system prompt construction, tool routing, context management, and fallback chains.
- **[Database](/developers/architecture/database)** — Prisma schema, key models, pgvector configuration, and migrations.
- **[Services](/developers/architecture/services)** — Directory of all backend services and their responsibilities.

## Extending Hearth

- **[SKILL.md Format](/developers/skill-format)** — Specification for creating agent skills.
- **[Skill Examples](/developers/skill-examples)** — Real-world skill patterns and templates.
- **[MCP Connectors](/developers/connectors/)** — How the Model Context Protocol powers integrations.
- **[Building Connectors](/developers/connectors/building)** — Step-by-step guide to creating a new connector.

## Contributing

- **[How to Contribute](/developers/contributing/)** — PR process, issue guidelines, and code of conduct.
- **[Development Setup](/developers/contributing/development)** — Local environment setup, commands, conventions, and testing.
