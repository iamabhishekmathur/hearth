# Contributing to Hearth

Thanks for your interest in contributing to Hearth. Here's how to get started.

## Setup

```bash
git clone https://github.com/iamabhishekmathur/hearth.git
cd hearth
cp .env.example .env        # Add your LLM API key
pnpm install
docker compose up -d         # Postgres + Redis
pnpm dev                     # Start web (3000) + API (8000)
```

Seed the database with sample data:

```bash
pnpm --filter api exec tsx src/scripts/seed-tasks.ts
```

## Project Structure

```
apps/web/          → React + Vite + Tailwind frontend
apps/api/          → Express + Socket.io API server
packages/shared/   → Shared TypeScript types and utilities
deploy/            → Docker + Helm deployment configs
e2e/               → Playwright end-to-end tests
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run `pnpm lint` and `pnpm test` before committing
4. Open a PR against `main`

## Code Conventions

- TypeScript everywhere — no `any` unless absolutely necessary
- API routes prefixed with `/api/v1/`
- Zod for request validation
- Prisma for database access — never raw SQL
- Pino for structured logging
- Tailwind CSS for styling — no CSS files

## Running Tests

```bash
pnpm test              # Unit tests
pnpm test:coverage     # With coverage
pnpm lint              # ESLint + Prettier
```

## What to Work On

Check the [Issues](https://github.com/iamabhishekmathur/hearth/issues) tab for open tasks. Issues tagged `good first issue` are a good starting point.

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Add tests for new functionality
- Don't commit secrets, API keys, or `.env` files
- Be kind in reviews and discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
