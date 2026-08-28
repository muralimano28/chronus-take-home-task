# Base node image
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@9.7.0 turbo@2.0.14
WORKDIR /app
COPY . .
RUN turbo prune --scope=api --docker

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
RUN adduser --system --uid 1001 express

# Copy workspaces and root node_modules (where actual files reside in .pnpm)
COPY --from=installer /app/node_modules/ ./node_modules/
COPY --from=installer /app/packages/ ./packages/
COPY --from=installer /app/apps/api/node_modules/ ./apps/api/node_modules/
COPY --from=installer /app/apps/api/package.json ./apps/api/package.json
COPY --from=installer /app/apps/api/dist/ ./apps/api/dist/

# Copy entrypoint script
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Change ownership of /app to express user
RUN chown -R express:nodejs /app

USER express

WORKDIR /app/apps/api
ENV PORT=3010
ENV NODE_ENV=production
EXPOSE 3010

ENTRYPOINT ["/app/docker-entrypoint.sh"]
