# =============================================================================
# Stage 1: Development
# =============================================================================
FROM node:20-alpine AS development

RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "dev"]

# =============================================================================
# Stage 2: Production Build
# =============================================================================
FROM node:20-alpine AS build

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM node:20-alpine AS production

RUN apk add --no-cache libc6-compat

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build --chown=nestjs:nodejs /app/dist ./dist

# Create directories for Claude credentials and plugins
RUN mkdir -p /home/nestjs/.claude && \
    mkdir -p /app/.claude/plugins && \
    chown -R nestjs:nodejs /home/nestjs/.claude /app/.claude

USER nestjs

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/main"]
