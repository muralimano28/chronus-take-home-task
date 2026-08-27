# Base node image
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@9.7.0 turbo@2.0.14
WORKDIR /app
COPY . .
RUN turbo prune --scope=web --docker

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

# Declare and pass build-time argument for Vite
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm build

# Runner stage using Nginx
FROM nginx:1.27-alpine AS runner
COPY --from=installer /app/apps/web/dist /usr/share/nginx/html
COPY --from=installer /app/apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
