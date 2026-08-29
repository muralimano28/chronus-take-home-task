# Base node image
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@9.7.0 turbo@2.0.14
WORKDIR /app
COPY . .
RUN turbo prune --scope=notification-worker --docker

# Installer stage - installs dependencies
FROM node:20-alpine AS installer
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@9.7.0
WORKDIR /app

# First copy the lockfile and package.json layout to cache installation
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY --from=pruner /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm build

# Runner stage
FROM node:20-alpine AS runner
WORKDIR /app
# Don't run as root in production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker

# Copy workspaces and root node_modules (where actual files reside in .pnpm)
COPY --from=installer /app/node_modules/ ./node_modules/
COPY --from=installer /app/packages/ ./packages/
COPY --from=installer /app/apps/notification-worker/node_modules/ ./apps/notification-worker/node_modules/
COPY --from=installer /app/apps/notification-worker/package.json ./apps/notification-worker/package.json
COPY --from=installer /app/apps/notification-worker/dist/ ./apps/notification-worker/dist/

# Change ownership of /app to worker user
RUN chown -R worker:nodejs /app

USER worker

WORKDIR /app/apps/notification-worker
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
