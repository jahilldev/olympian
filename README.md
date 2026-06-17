# <img src="app/public/icons/icon.svg" alt="" width="60" valign="middle" /> Olympian

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
`github`, `webhook`, `job`, `queue`, `worker`, `agent`, `workspace`,
`review`, `orchestrator`.

## Monorepo layout

This is an npm-workspaces monorepo, driven from the root:

- **`api/`** — The orchestration service (API and agent orchestration).
- **`app/`** — A management/overview UI for tasks (PWA application for monitoring).

Root scripts fan out to the workspaces: `npm run build`, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run dev`, plus the
`prisma:*` and `hermes:*` helpers. See the root [`package.json`](package.json).

## Quick start

### Development

```bash
cp api/.env.example api/.env    # fill in GitHub App + Hermes values
npm run setup                   # installs all workspaces + generates client + migrates
npm run dev                     # runs the api service in watch mode
```

Probe it:

```bash
curl localhost:3030/health        # liveness
curl localhost:3030/health/ready  # readiness (DB)
curl localhost:3030/metrics       # Prometheus metrics
```

### Production (systemd)

Run `setup.sh` once to register the `olympian` systemd service under your current user:

```bash
./setup.sh
```

The script detects your Node/npm paths automatically and writes
`/etc/systemd/system/olympian.service`, then enables it to start on boot. It uses `sudo`
only for the two privileged steps (writing the unit file and `systemctl daemon-reload`).

After running the script:

```bash
sudo systemctl start olympian    # start the service
sudo systemctl status olympian   # check it is running
sudo journalctl -u olympian -f   # follow logs
```

On every start the service runs `npm ci`, `npm run setup` (Prisma migrate), `npm run build` before launching the production server, so deployments are as
simple as `git pull && sudo systemctl restart olympian`.

To uninstall:

```bash
sudo systemctl disable --now olympian
sudo rm /etc/systemd/system/olympian.service
sudo systemctl daemon-reload
```

## Required external setup

These can't be scripted for you and gate the live run (not the build or tests):

### 1. Register a GitHub App

- **Permissions:** Issues _Read & write_, Pull requests _Read & write_, Contents _Read &
  write_, Metadata _Read-only_.
- **Subscribe to events:** Issues, Issue comment, Pull request review, Installation.
- **Webhook URL:** `https://<your-host>/webhooks/github` and a **webhook secret**.
- Generate a **private key** (PEM). Install the App on the target repos.
- Put the values in `.env`: `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, and either
  `GITHUB_APP_PRIVATE_KEY` (inline, `\n`-escaped) or `GITHUB_APP_PRIVATE_KEY_PATH`.

For local dev, tunnel webhooks with [smee.io](https://smee.io) or ngrok to
`localhost:3030/webhooks/github`.

### 2. Provision Hermes

```bash
npm run hermes:docker    # builds api/Dockerfile.agent; writes SANDBOX_MODE/DOCKER_AGENT_IMAGE/HERMES_HOME to api/.env
```

Each agent invocation runs inside an isolated container with only the job worktree and
the shared `HERMES_HOME` (`api/.hermes/`) bind-mounted. The orchestrator generates
`config.yaml` from `config.base.yaml` at startup, injecting env-var overrides
(`HERMES_CONTEXT_LENGTH`, `HERMES_COMPRESS_THRESHOLD`, `HERMES_MODEL_BASE_URL`) and
rewriting `localhost` → `host.docker.internal` for in-container connectivity.

After running the script, set your model and provider in `api/.env`:

```
HERMES_PRIMARY_MODEL=<model>
HERMES_PRIMARY_PROVIDER=<provider>
HERMES_MODEL_BASE_URL=http://localhost:11434/v1   # if using a local endpoint
```

For cloud providers, add the relevant API key (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

**System mode (no Docker):** set in `api/.env`:

```
SANDBOX_MODE=none
HERMES_HOME=~/.hermes   # your existing global Hermes home — credentials and model config already there
```

Hermes reads its own `~/.hermes/config.yaml` directly. `HERMES_PRIMARY_MODEL`,
`HERMES_PRIMARY_PROVIDER`, and `HERMES_TIMEOUT_MS` still apply as they are passed as
CLI flags at invocation time.

### 3. Camofox browser (optional)

[Camofox](https://github.com/jo-inc/camofox-browser) is a self-hosted Firefox-based
browser server with fingerprint spoofing. When configured, Hermes's browser tools
(`browser_navigate`, `browser_click`, etc.) route through it instead of cloud providers
like Browserbase.

**Start Camofox** (Docker, port 9377):

```bash
git clone https://github.com/jo-inc/camofox-browser
cd camofox-browser
make up          # builds + starts on port 9377
```

**Wire it to Olympian** — add to `api/.env`:

```bash
CAMOFOX_URL=http://localhost:9377
```

That's all. In `SANDBOX_MODE=default` the orchestrator automatically rewrites the URL to
`host.docker.internal:9377` before passing it into the agent container.

To opt out: leave `CAMOFOX_URL` empty (or unset) — Hermes falls back to `agent-browser`
(a local Chromium install) or errors if no browser backend is available.

## Using it

1. Label an issue `hermes` (or your `TRIGGER_LABEL`).
2. Hermes posts a plan. Reply with comments to iterate, or `/hermes approve` to build.
3. A draft PR appears. **Approve** the PR review to finish, or **request changes** to loop.

Issue-comment commands (maintainers only — write access required):

- `/hermes approve` — approve the plan and start implementation
- `/hermes cancel` — stop the job
- `/hermes status` — report current state

## Frontend

A management dashboard is served at `http://localhost:3030` by the same NestJS process — no second server or Docker change required.

**Job Planner** - Coming soon

**Job list** — all jobs in reverse-chronological order, each showing state, confidence score, PR link, and the active task.

**Job detail** — timeline of every state transition, all plan revisions (with diff), every review pass (confidence gauge, issues list), and the full list of agent runs.

**Live stream** — while an agent is running, its LLM calls and tool invocations appear in real time. The Hermes agent ships a Langfuse/OTLP plugin that fires trace events during execution; the service receives them at `POST /langfuse/api/public/otel/v1/traces` and fans them out to the browser over SSE at `GET /stream/runs/:runId`.

The Astro + Preact frontend is built to `app/dist/` and served via NestJS `ServeStaticModule`. All routes not matching an API prefix fall back to `index.html` for client-side routing.

## Sandboxing

- `SANDBOX_MODE=default` (default) — each agent invocation runs inside `DOCKER_AGENT_IMAGE`.
  Only the job's worktree and the Hermes memory files (`MEMORY.md`, `USER.md`, `skills/`,
  `config.yaml`) are bind-mounted into the container. Requires Docker and a pre-built
  image (`npm run hermes:docker`). Raising `WORKER_CONCURRENCY` runs N fully isolated
  jobs in parallel.
- `SANDBOX_MODE=none` — `hermes` runs as a subprocess directly in the job's worktree,
  using the system-level Hermes binary (`HERMES_BIN`). No Docker required; useful for
  local development or environments where Docker is unavailable.

## Configuration

All config is validated at boot (see `src/config/config.model.ts`). Full reference and
defaults live in [`api/.env.example`](api/.env.example). Key knobs:

| Variable                                                                        | Purpose                                                                                   |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `TRIGGER_LABEL`                                                                 | Label that starts a job (default `hermes`).                                               |
| `REVIEW_CONFIDENCE_THRESHOLD`                                                   | Min self-review confidence to open a PR (default 85).                                     |
| `MAX_PLAN_REVISIONS` / `MAX_IMPLEMENTATION_ITERATIONS` / `MAX_REVIEW_PASSES`    | Loop caps.                                                                                |
| `WORKER_CONCURRENCY`                                                            | Parallel jobs (default 2).                                                                |
| `VERIFY_COMMAND`                                                                | Optional tests/build command used as an acceptance gate.                                  |
| `SANDBOX_MODE`                                                                  | `default` (Docker container per run) or `none` (system Hermes binary, no container).      |
| `HERMES_BIN` / `HERMES_HOME` / `HERMES_PRIMARY_MODEL`                           | Hermes invocation.                                                                        |
| `HERMES_CONTEXT_LENGTH` / `HERMES_COMPRESS_THRESHOLD` / `HERMES_MODEL_BASE_URL` | Injected into Hermes `config.yaml` at startup; omit to let Hermes use its own defaults.   |
| `HERMES_REVIEW_MODEL` / `HERMES_REVIEW_PROVIDER`                                | Optional independent model for the self-review cycle.                                     |
| `HERMES_TESTING_MODEL` / `HERMES_TESTING_PROVIDER`                              | Optional lighter-weight model for the testing step. Falls back to `HERMES_PRIMARY_MODEL`. |

## Docker

```bash
# 1. Build the agent sandbox image.
npm run hermes:docker

# 2. Configure the service.
cd api && cp .env.example .env   # fill in GitHub App + model values

# 3. Start.
docker compose up --build        # from repo root: builds the service image
```

SQLite lives on a named volume (`hermes-data`); there is no separate database container.
Agent workspaces and the Hermes memory state (`MEMORY.md`, `USER.md`, `skills/`) are
bind-mounted from `./workspaces/` and `./hermes-state/` at the **same absolute path**
inside the service container, so sibling agent containers spawned via the Docker socket
can reference those directories using the same host path the service wrote to.

> **Langfuse observability** — the env var forwarding and URL rewriting are in place, but
> the `POST /api/public/otel/v1/traces` ingestion endpoint has not yet been implemented.
> Traces sent by the agent plugin are currently dropped. Enable Langfuse only after the
> trace ingestion module is added.

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
