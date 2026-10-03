# Stage 1: Base image
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.1.0 --activate
WORKDIR /app

# Stage 2: Install dependencies
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/iam/package.json ./packages/iam/
COPY packages/openapi/package.json ./packages/openapi/
COPY packages/shared/package.json ./packages/shared/
COPY packages/validation/package.json ./packages/validation/
RUN pnpm install --frozen-lockfile

# Stage 3: Build application and workspace packages
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN pnpm --filter "@packages/*" build
RUN pnpm --filter @app/api build

# Stage 4: Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 fastify

COPY --from=deps --chown=fastify:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=fastify:nodejs /app/packages ./packages
COPY --from=builder --chown=fastify:nodejs /app/apps/api ./apps/api
COPY --from=builder --chown=fastify:nodejs /app/package.json ./package.json

USER fastify

EXPOSE 3001

CMD ["node", "apps/api/dist/server.js"]
