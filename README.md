# Hearth

**Turn what your best AI users learn into the company playbook.**

Hearth is a team AI workspace that captures successful AI workflows from power
users and turns them into installable team Skills. Context, approvals, and
company policies stay attached as those workflows spread.

[Evaluate with Hearth Cloud](docs/getting-started/cloud.md) |
[See how the product works](docs/guide/index.md) |
[Self-host the open-source core](docs/getting-started/self-hosted.md)

## The Adoption Gap

Most teams already have access to AI. A few people learn how to combine good
prompts, company context, tools, and judgment into valuable workflows. Everyone
else keeps opening a blank chat, rebuilding context, and learning the same
lessons again.

Hearth turns those private gains into shared team capability:

1. Someone completes useful work in Hearth.
2. The successful pattern becomes a published Skill.
3. Activity makes the Skill visible to teammates.
4. Teammates install it instead of starting from scratch.
5. Context, approvals, policies, and improvements stay with the workflow.

## One Workspace, Four Surfaces

| Surface      | What it does                                                                          |
| ------------ | ------------------------------------------------------------------------------------- |
| **Chat**     | Teammates and AI work together in shared sessions with files, context, and artifacts. |
| **Tasks**    | Agents plan and execute accountable work, then return it for human review.            |
| **Routines** | Proven workflows run on demand, on a schedule, or from a trigger.                     |
| **Activity** | Teams see published Skills and install useful patterns into their own work.           |

Hearth can detect work assigned in connected tools, gather relevant context,
plan allowed steps, and bring results back for approval. Governance policies,
sensitive-data controls, audit history, model choice, and organizational memory
form the trust layer beneath the workflow.

## Start with Hearth Cloud

**Hearth Cloud is the default evaluation path.** It provides the managed product
experience so a team can test a real workflow without first operating Postgres,
Redis, workers, backups, upgrades, or ingress.

Start with a small team and one repeated workflow:

1. Create or join a Hearth Cloud workspace.
2. Invite the people who already understand the workflow.
3. Connect the systems that hold its context.
4. Complete the work once in Chat or Tasks.
5. Publish the successful pattern as a Skill so teammates can install it through Activity.
6. Review approvals and governance before expanding access.

See [Start with Hearth Cloud](docs/getting-started/cloud.md) for the setup path.

## Open-Source Self-Hosting

Self-hosting is the open-source alternative for organizations that need source
inspection, infrastructure control, private-network deployment, local models,
or source-level customization. Your team operates the application, data stores,
secrets, backups, upgrades, monitoring, and network controls.

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env
# Add at least one supported LLM provider to .env
docker compose up
```

Open `http://localhost:3000` and complete the setup wizard. For production
requirements, use the [self-hosting guide](docs/self-hosting/index.md), including
the [Docker Compose](docs/self-hosting/docker.md) and
[Kubernetes](docs/self-hosting/kubernetes.md) deployment paths.

## Explore the Platform

The first product story stays focused on team adoption. Advanced capabilities
remain fully documented:

- [Chat](docs/guide/chat.md), [Tasks](docs/guide/tasks.md),
  [Routines](docs/guide/routines.md), and [Activity](docs/guide/activity.md)
- [Memory](docs/guide/memory.md), [Skills](docs/guide/skills.md),
  [Artifacts](docs/guide/artifacts.md), and [Decisions](docs/guide/decisions.md)
- [Governance](docs/admin/governance.md),
  [Compliance](docs/admin/compliance.md),
  [Audit Logs](docs/admin/audit-logs.md), and
  [LLM Providers](docs/admin/llm-providers.md)
- [Integrations](docs/admin/integrations.md),
  [API reference](docs/developers/api/index.md), and
  [connector development](docs/developers/connectors/index.md)

## Architecture

```text
Frontend (React + Vite)
        |
API server (Express + Socket.io) <-> Worker (BullMQ)
        |                              |
        +---- PostgreSQL + pgvector ---+
        +---- Redis -------------------+
```

| Layer    | Stack                                        |
| -------- | -------------------------------------------- |
| Frontend | React, Vite, Tailwind CSS                    |
| Backend  | Node.js, Express, Socket.io                  |
| Database | PostgreSQL with pgvector via Prisma          |
| Queue    | BullMQ on Redis                              |
| Auth     | Passport.js with local, OAuth, and SSO paths |
| Monorepo | Turborepo and pnpm workspaces                |

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and boundaries.

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker for Postgres and Redis

```bash
pnpm install
cp .env.example .env
# Add your LLM provider configuration
docker compose up -d postgres redis
pnpm dev
```

Common checks:

```bash
pnpm build
pnpm test
pnpm lint
```

Project layout:

```text
apps/web/          React and Vite frontend
apps/api/          Express API and Socket.io server
packages/shared/   Shared types and utilities
docs/              VitePress documentation
deploy/            Docker and Helm deployment configuration
e2e/               Playwright end-to-end tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

The code in this repository is licensed under the
[GNU Affero General Public License, version 3](LICENSE). See `LICENSE` for the
complete terms.
