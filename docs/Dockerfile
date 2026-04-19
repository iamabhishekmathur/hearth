FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY docs/package.json docs/
RUN pnpm install --frozen-lockfile || pnpm install

# Build docs
FROM deps AS build
COPY docs/ docs/
RUN pnpm --filter @hearth/docs build

# Serve with nginx
FROM nginx:alpine
COPY --from=build /app/docs/.vitepress/dist /usr/share/nginx/html
COPY docs/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
