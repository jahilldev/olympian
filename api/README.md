# Hermes Orchestrator (`olympian/api`)

The NestJS service behind the Hermes Agent "dark factory": it turns a labeled GitHub
issue into a reviewed, human-approved draft PR by driving the
[Hermes Agent](https://github.com/nousresearch/hermes-agent) CLI through plan →
implement → self-review → PR, with humans only ever approving the plan and the PR.

> For the full architecture, the end-to-end flow, GitHub App registration, and the
> Hermes provisioning runbook, see the [project README](../README.md).

## Overview

- **Stack:** NestJS (ESM), Prisma + **SQLite** (file-based — no DB server), a Postgres-free
  polling work queue, GitHub App auth, and the `hermes` CLI as the coding engine.
- **Source of truth:** Prisma stores every job's state, plan revisions, agent runs, reviews,
  and queue tasks. Each agent prompt is rebuilt deterministically from the database.
- **Modules** (`src/<module>/`, one service each): `config`, `prisma`, `metrics`, `health`,
  `github-app`, `github-api`, `webhook`, `job`, `queue`, `worker`, `agent`, `workspace`,
  `review`, `orchestrator`.
- **Endpoints:** `POST /webhooks/github` (HMAC-verified), `GET /health`, `GET /health/ready`,
  `GET /metrics` (Prometheus).

## Prerequisites

- Node.js 20+
- Hermes — run `npm run hermes:docker` from the repo root to build the agent sandbox image
  and wire an isolated, project-local `HERMES_HOME`. See the [project README](../README.md#2-provision-hermes).
- A GitHub App (for the live flow) — see the [project README](../README.md)

## Installation

This package is an npm workspace; the simplest path is from the repo root:

```bash
cp api/.env.example api/.env   # fill in GitHub App + Hermes values
npm run setup                  # from the repo root: installs workspaces + migrates
```

Or work inside this package directly:

```bash
cd api
cp .env.example .env
npm install                    # installs the whole workspace tree
npx prisma migrate dev         # creates prisma/dev.db and applies migrations
```

## Running

```bash
npm run start:dev           # watch mode
# or
npm run build && npm run start:prod
```

Verify it's up:

```bash
curl localhost:3030/health        # liveness
curl localhost:3030/health/ready  # readiness (database)
curl localhost:3030/metrics       # Prometheus metrics
```

## Testing

```bash
npm test            # unit tests
npm run test:e2e    # full pipeline e2e (stubbed Hermes + faked GitHub; no creds needed)
npm run lint        # eslint (zero warnings)
npm run typecheck   # tsc --noEmit
```

## Configuration

All environment variables are validated at boot (`src/config/config.model.ts`); the full
list with defaults lives in [`.env.example`](.env.example). Common knobs: `TRIGGER_LABEL`,
`REVIEW_CONFIDENCE_THRESHOLD`, `WORKER_CONCURRENCY`, `SANDBOX_MODE`, `VERIFY_COMMAND`,
`HERMES_BIN` / `HERMES_PRIMARY_MODEL` / `HERMES_REVIEW_MODEL` / `HERMES_TESTING_MODEL`,
`HERMES_CONTEXT_LENGTH` / `HERMES_COMPRESS_THRESHOLD` / `HERMES_MODEL_BASE_URL`.

## Docker

```bash
# from the repo root (builds this package's Dockerfile)
docker compose up --build
```

SQLite lives on a named volume; there is no separate database container.
