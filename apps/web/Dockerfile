FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile || pnpm install

# Build shared package
FROM deps AS build-shared
COPY packages/shared/ packages/shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @hearth/shared build

# Build frontend
FROM deps AS build
COPY --from=build-shared /app/packages/shared/dist packages/shared/dist
COPY apps/web/ apps/web/
COPY packages/shared/ packages/shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @hearth/web build

# Production — serve with nginx
FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
