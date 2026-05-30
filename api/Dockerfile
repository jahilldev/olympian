# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# git: required by the workspace module (clone/commit/push).
# openssl + ca-certificates: Prisma engine + HTTPS git remotes.
# NOTE: with SANDBOX_MODE=none the `hermes` binary must also be on PATH in this
# image; with SANDBOX_MODE=docker the agent runs in DOCKER_AGENT_IMAGE instead
# (mount the Docker socket and set the image).
RUN apk add --no-cache git openssh-client ca-certificates openssl
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3030
ENTRYPOINT ["./docker-entrypoint.sh"]
