FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile || pnpm install

# Build shared package
FROM deps AS build-shared
COPY packages/shared/ packages/shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @hearth/shared build

# Build API
FROM deps AS build
COPY --from=build-shared /app/packages/shared/dist packages/shared/dist
COPY apps/api/ apps/api/
COPY packages/shared/ packages/shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @hearth/api build

# Production
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY --from=build /app/node_modules node_modules/
COPY --from=build /app/apps/api/node_modules apps/api/node_modules/
COPY --from=build /app/apps/api/dist apps/api/dist/
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/packages/shared/dist packages/shared/dist/
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/apps/api/prisma apps/api/prisma/

WORKDIR /app/apps/api
EXPOSE 8000
CMD ["node", "dist/index.js"]
