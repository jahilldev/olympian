# Hermes Agent Orchestration Service ("Olympian")

An **AI dark factory**: label a GitHub issue and the service drives the
[Hermes Agent](https://github.com/nousresearch/hermes-agent) CLI through the entire
delivery lifecycle — planning, implementation, self-review, and a draft PR — with a
human only ever approving the plan and the final PR. No human writes code.

```
issue labeled ──▶ PLAN ──▶ (human approves plan) ──▶ IMPLEMENT ──▶ SELF-REVIEW ⇄ REVISE
                    ▲             │                                        │
                    └─ feedback ──┘                          (confidence ≥ threshold)
                                                                          │
                                                                          ▼
                              (human approves PR) ◀── AWAIT PR REVIEW ◀── OPEN DRAFT PR
                                      │                     ▲                 
                                      ▼                     └── changes requested ──▶ IMPLEMENT
                                    DONE
```

## How it works

1. **Trigger.** An issue is labeled with the trigger label (default `hermes`). A `Job` is created.
2. **Plan.** Hermes reads the issue (in a clone of the repo) and posts an implementation
   plan as an issue comment.
3. **Plan approval loop.** A maintainer replies `/hermes approve` to proceed, or leaves a
   comment with corrections — each comment re-plans until approved (capped by `MAX_PLAN_REVISIONS`).
4. **Implement.** Hermes writes the code on a branch (`hermes/issue-<n>`). An optional
   `VERIFY_COMMAND` (tests/build) gates the work, iterating up to `MAX_IMPLEMENTATION_ITERATIONS`.
5. **Self-review.** Hermes reviews its own diff and returns a JSON verdict
   `{confidence, verdict, issues[]}`. Below `REVIEW_CONFIDENCE_THRESHOLD` it revises and
   re-reviews, up to `MAX_REVIEW_PASSES`.
6. **Draft PR.** The branch is pushed and a **draft** PR is opened, linking the issue.
7. **PR approval loop.** Approve the PR review → the job is `DONE`. Request changes → the
   implementation loop runs again and pushes an update.

The orchestrator owns git; Hermes only edits files. **Prisma (SQLite) is the source of
truth** for every job's state, plan revisions, agent runs, reviews, and the work queue —
each Hermes prompt is rebuilt deterministically from the database.

## Tech stack

- **NestJS** (ESM, `"type": "module"`, NodeNext) — modular service.
- **Prisma + SQLite** — file-based; no DB server to provision.
- **DB-backed queue** — a polling worker claims tasks with an atomic `UPDATE ... RETURNING`
  (SQLite-safe), with exponential backoff/retry and per-job concurrency isolation.
- **GitHub App** — webhooks, scoped installation tokens, comments, draft PRs, reviews.
- **Hermes Agent CLI** — invoked headless: `hermes -z --yolo --source tool --max-turns N`.

Module layout (one service per module): `config`, `prisma`, `metrics`, `health`,
`github-app`, `github-api`, `webhook`, `job`, `queue`, `worker`, `agent`, `workspace`,
`review`, `orchestrator`.

## Monorepo layout

This is an npm-workspaces monorepo, driven from the root:

- **`api/`** — the orchestration service (this is the whole product today).
- **`app/`** — a management/overview UI (planned; not yet present).

Root scripts fan out to the workspaces: `npm run build`, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run dev`, plus the
`db:*` helpers. See the root [`package.json`](package.json).

## Quick start (local)

```bash
cp api/.env.example api/.env    # fill in GitHub App + Hermes values
npm run setup                   # installs all workspaces + generates client + migrates
npm run dev                     # runs the api service in watch mode
```

Probe it:

```bash
curl localhost:3000/health        # liveness
curl localhost:3000/health/ready  # readiness (DB)
curl localhost:3000/metrics       # Prometheus metrics
```

## Required external setup

These can't be scripted for you and gate the live run (not the build or tests):

### 1. Register a GitHub App
- **Permissions:** Issues *Read & write*, Pull requests *Read & write*, Contents *Read &
  write*, Metadata *Read-only*.
- **Subscribe to events:** Issues, Issue comment, Pull request review, Installation.
- **Webhook URL:** `https://<your-host>/webhooks/github` and a **webhook secret**.
- Generate a **private key** (PEM). Install the App on the target repos.
- Put the values in `.env`: `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, and either
  `GITHUB_APP_PRIVATE_KEY` (inline, `\n`-escaped) or `GITHUB_APP_PRIVATE_KEY_PATH`.

For local dev, tunnel webhooks with [smee.io](https://smee.io) or ngrok to
`localhost:3000/webhooks/github`.

### 2. Provision Hermes
- Install the `hermes` CLI (set `HERMES_BIN`) **or** build the sandbox image
  (`docker build -f Dockerfile.agent -t hermes-agent .`) and set `SANDBOX_MODE=docker`.
- Configure provider credentials/model under `HERMES_HOME` (`~/.hermes`), or set
  `HERMES_MODEL`/`HERMES_PROVIDER`.

## Using it

1. Label an issue `hermes` (or your `TRIGGER_LABEL`).
2. Hermes posts a plan. Reply with comments to iterate, or `/hermes approve` to build.
3. A draft PR appears. **Approve** the PR review to finish, or **request changes** to loop.

Issue-comment commands (maintainers only — write access required):
- `/hermes approve` — approve the plan and start implementation
- `/hermes cancel` — stop the job
- `/hermes status` — report current state

## Sandboxing

- `SANDBOX_MODE=none` (default) runs `hermes` as a subprocess in the job's worktree.
- `SANDBOX_MODE=docker` runs each agent invocation inside `DOCKER_AGENT_IMAGE`, mounting
  **only** that job's directory and the read-only Hermes config. Each job lives in its own
  directory keyed by job id, so raising `WORKER_CONCURRENCY` runs N isolated jobs in parallel.

## Configuration

All config is validated at boot (see `src/config/config.model.ts`). Full reference and
defaults live in [`api/.env.example`](api/.env.example). Key knobs:

| Variable | Purpose |
| --- | --- |
| `TRIGGER_LABEL` | Label that starts a job (default `hermes`). |
| `REVIEW_CONFIDENCE_THRESHOLD` | Min self-review confidence to open a PR (default 85). |
| `MAX_PLAN_REVISIONS` / `MAX_IMPLEMENTATION_ITERATIONS` / `MAX_REVIEW_PASSES` | Loop caps. |
| `WORKER_CONCURRENCY` | Parallel jobs (default 2). |
| `VERIFY_COMMAND` | Optional tests/build command used as an acceptance gate. |
| `SANDBOX_MODE` | `none` or `docker`. |
| `HERMES_BIN` / `HERMES_HOME` / `HERMES_MODEL` / `HERMES_MAX_TURNS` | Hermes invocation. |

## Docker

```bash
cd api && cp .env.example .env   # fill in values
docker compose up --build        # from repo root: builds the api image
```

SQLite lives on a named volume; there is no separate database container.

## Operations

- **Health:** `/health` (liveness), `/health/ready` (DB).
- **Metrics:** `/metrics` — job counts by state, queue depth, agent run durations, webhook
  counts, last review confidence.
- **Audit trail:** every state transition (`JobStateTransition`) and every Hermes
  invocation (`AgentRun`) is persisted; inspect with `npx prisma studio`.
- **Retries:** failed tasks back off exponentially up to `QUEUE_MAX_ATTEMPTS`; exhausted
  jobs are failed and a comment is posted. Orphaned tasks are reclaimed after `QUEUE_LOCK_TTL_MS`.

## Tests

```bash
cd api
npm test        # unit
npm run test:e2e  # full webhook→plan→approve→implement→review→PR loop with a stub Hermes
```

The e2e suite stubs the Hermes agent and fakes the GitHub API, so the entire pipeline runs
in CI without real LLM or GitHub credentials.
