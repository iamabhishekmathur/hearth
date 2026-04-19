# Development Setup

This guide walks you through setting up a local Hearth development environment from scratch.

## Prerequisites

Make sure the following are installed on your machine before proceeding:

| Dependency | Version | Notes |
|------------|---------|-------|
| **Node.js** | 22+ | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage versions. |
| **pnpm** | Latest | Install with `corepack enable && corepack prepare pnpm@latest --activate`, or see [pnpm.io](https://pnpm.io/installation). |
| **PostgreSQL** | 15+ | Must have the [pgvector](https://github.com/pgvector/pgvector) extension installed for embedding storage. |
| **Redis** | 7+ | Used for caching and BullMQ job queues. |

## Clone and Install

```bash
git clone https://github.com/your-org/hearth.git
cd hearth
pnpm install
```

`pnpm install` bootstraps the entire monorepo, including all apps and packages, via Turborepo.

## Environment Setup

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env
```

At a minimum you will need to configure:

- **Database URL** -- a PostgreSQL connection string pointing to your local database, with pgvector enabled.
- **Redis URL** -- connection string for your local Redis instance.
- **Session secret** -- a random string used to sign session cookies.
- **Encryption key** -- used for AES-256-GCM encryption of integration tokens. Generate a 32-byte hex key.

LLM provider keys (Anthropic, OpenAI) can be configured later through the setup wizard or admin panel.

## Database

Run Prisma migrations to create the schema:

```bash
cd apps/api
npx prisma migrate dev
```

This applies all migrations and generates the Prisma client.

## Running the App

From the repository root:

```bash
pnpm dev
```

This starts both the web frontend and the API server in development mode with hot reload. By default:

- **Web:** `http://localhost:5173`
- **API:** `http://localhost:3000`

On first visit, the setup wizard will guide you through creating an admin account and connecting an LLM provider.

## Commands Reference

All commands are run from the repository root unless otherwise noted.

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies across the monorepo. |
| `pnpm dev` | Start web and API in development mode. |
| `pnpm build` | Build all packages for production. |
| `pnpm test` | Run the unit test suite. |
| `pnpm test:coverage` | Run tests with coverage reporting. |
| `pnpm lint` | Check code with ESLint and Prettier. |
| `pnpm lint:fix` | Auto-fix lint and formatting issues. |

## Project Structure

```
apps/web/          React + Vite frontend
apps/api/          Express + Socket.io API server
packages/shared/   Shared types and utilities
docs/              VitePress documentation site
deploy/            Docker + Helm deployment configs
docker/            Sandbox Dockerfiles
e2e/               Playwright end-to-end tests
```

### apps/web

The frontend is built with React, Vite, Tailwind CSS, and shadcn/ui components. Pages are in `src/pages/`, reusable components in `src/components/`, and custom hooks in `src/hooks/`.

### apps/api

The backend is an Express server with Socket.io for real-time communication. Key directories:

- `src/routes/` -- HTTP route handlers, all prefixed with `/api/v1/`.
- `src/services/` -- Business logic and data access via Prisma.
- `src/agent/` -- Agent runtime, system prompt, tool router, and context builder.
- `src/jobs/` -- BullMQ job processors for background tasks (routines, digests).
- `src/llm/` -- LLM provider integrations and registry.
- `prisma/` -- Database schema and migrations.

### packages/shared

Shared TypeScript types and utilities used by both the web and API apps.

## Tech Stack

- **Language:** TypeScript across the entire stack.
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui.
- **Backend:** Node.js + Express + Socket.io.
- **Database:** PostgreSQL with pgvector for vector similarity search, accessed through Prisma ORM.
- **Cache and Queues:** Redis + BullMQ for job scheduling and caching.
- **Package Manager:** pnpm.
- **Monorepo:** Turborepo for task orchestration across packages.

## Conventions

The codebase follows these conventions consistently. Please adhere to them in your contributions:

- **API routes** are prefixed with `/api/v1/`.
- **Runtime validation** uses Zod for both environment variables and request bodies.
- **Logging** uses Pino for structured JSON output. Do not use `console.log` in production code.
- **Authentication** relies on HTTP-only secure cookies for sessions.
- **Secrets** are encrypted with AES-256-GCM. Never store secrets in plaintext in code or logs.
- **Database access** always goes through Prisma. Never write raw SQL queries.
- **Auth middleware** must be applied to all protected routes. Never skip it.

## Testing

Run the full test suite with:

```bash
pnpm test
```

For coverage reporting:

```bash
pnpm test:coverage
```

When writing tests:

- Place test files alongside the source file they test, using the `.test.ts` naming convention (e.g., `embedding-service.test.ts` next to `embedding-service.ts`).
- Test business logic in services thoroughly. Mock external dependencies (LLM providers, database) as needed.
- For API routes, test both success and error paths, including validation failures and auth checks.

End-to-end tests live in the `e2e/` directory and use Playwright. See the README in that directory for details on running them.

## Further Reading

- [Architecture documentation](/developers/architecture/) -- deep dive into system design, data models, and component interactions.
- [First Run / Setup Wizard](/getting-started/first-run) -- what to expect when you launch Hearth for the first time.
- [How to Contribute](./) -- PR process, issue guidelines, and other ways to help.
