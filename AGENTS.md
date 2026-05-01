# Hearth

Hearth is an open-source AI productivity platform for teams. See ARCHITECTURE.md for technical architecture.

## Project Structure

```
apps/web/          → React + Vite frontend
apps/api/          → Express + Socket.io API server
packages/shared/   → Shared types and utilities
docs/              → VitePress documentation site
deploy/            → Docker + Helm deployment configs
docker/            → Sandbox Dockerfiles
e2e/               → Playwright end-to-end tests
```

## Commands

- `pnpm install` — Install all dependencies
- `pnpm dev` — Start web + api in development mode
- `pnpm build` — Build all packages
- `pnpm test` — Run unit tests
- `pnpm test:coverage` — Run tests with coverage
- `pnpm lint` — ESLint + Prettier check
- `pnpm lint:fix` — Auto-fix lint issues

## Tech Stack

- **Language:** TypeScript (full-stack)
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Node.js + Express + Socket.io
- **Database:** PostgreSQL + pgvector (via Prisma ORM)
- **Cache/Queue:** Redis + BullMQ
- **Package Manager:** pnpm
- **Monorepo:** Turborepo

## Conventions

- All API routes prefixed with `/api/v1/`
- Zod for runtime validation of env vars and request bodies
- Pino for structured JSON logging
- HTTP-only secure cookies for sessions
- AES-256-GCM for encrypting integration tokens

## Boundaries

- Always: Follow ARCHITECTURE.md interfaces when implementing features
- Always: Use Prisma for database access, never raw SQL
- Never: Store secrets in code or logs
- Never: Skip auth middleware on protected routes

## Documentation

- When modifying user-facing features, update the corresponding doc page in `docs/`
- See `docs/CODE_TO_DOCS_MAP.md` for source → doc page mapping
- When adding new features, add documentation to the appropriate guide page in `docs/guide/`
- When adding new API routes, update the corresponding page in `docs/developers/api/`
- When modifying the database schema, update `docs/developers/architecture/database.md`
- When modifying admin features, update the corresponding page in `docs/platform/`
- When adding new pages or routes, update `docs/CODE_TO_DOCS_MAP.md`
