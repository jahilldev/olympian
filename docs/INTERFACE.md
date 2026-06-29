# Olympian — Interface & Job-Creation Plan

> Implementation plan for expanding the dashboard from a **monitoring** surface into a
> **control** surface: create jobs from the UI (not just GitHub webhooks), and run a
> general Hermes chat. Grounded in the current codebase; reuses the existing
> plan → verify → revise → review loop wherever possible.

---

## 1. Goals

1. **Create** button on the home page → a chat-style composer where a user writes
   markdown requirements (like a GitHub issue) and optionally attaches a git repo in
   **SSH** form. Submitting kicks off the existing pipeline with plan iteration; the plan
   is approved with an **Approve** button (not a `/hermes approve` comment); then the
   normal IMPLEMENT → VERIFY → REVISE → REVIEW loop runs.
2. The repo is **optional** and can be **provided or changed at any time** by the user.
3. **Chat** button next to Create → a normal interactive Hermes session for general work
   (research, Q&A) that is _not_ a delivery job.

Non-goals (v1): authentication (dashboard stays localhost/trusted-network), opening real
PRs for dashboard jobs (SSH push only), multi-user.

---

## 2. What we build on (current state)

The pieces this plan reuses — all already shipped:

- **Pipeline** (`orchestrator.service.ts`): `PLAN → (approve) → IMPLEMENT → VERIFY → SELF_REVIEW → OPEN_PR → AWAITING_PR_APPROVAL → DONE`, with every post-implement failure looping through REVISE. State machine in `job/job.model.ts`; task kinds in `queue/queue.model.ts`.
- **Operator actions**: `OrchestratorService.cancelJob()` / `retryJob()` exposed via `OrchestratorController` (`POST /api/jobs/:id/cancel|retry`). **This is the exact pattern to mirror** for approve/feedback/accept.
- **Plan storage**: `PlanRevision` + `PlanFeedback` tables already hold the full plan-iteration history; `JobDetail.tsx` already renders plans. The dashboard "requirements chat" is essentially this history surfaced as a conversation.
- **Agent runner**: `HermesAgentService.run()` + `buildAgentSpec()` (container) / host mode; live activity via the Langfuse OTLP→SSE pipeline (`/stream/runs/:runId`). Reused for both jobs and chat.
- **Workspace**: `workspace.service.ts` owns clone/commit/push and the in-container verify; today it auths via GitHub **installation tokens** over HTTPS.
- **Read API**: `JobController` (`/api/jobs`, `:id`, `:id/runs`, `:id/reviews`, `:id/verifications`). SPA path fallback in `interface/interface.utility.ts`; Astro pages under `app/src/pages/`.

---

## 3. Architecture decisions

### 3.1 Job origin

Add `Job.origin: 'GITHUB' | 'DASHBOARD'`. This single field drives every fork:

| Concern                  | `GITHUB`                          | `DASHBOARD`                                 |
| ------------------------ | --------------------------------- | ------------------------------------------- |
| Trigger                  | issue labelled (`onIssueLabeled`) | `POST /api/jobs`                            |
| Plan surfaced via        | issue comment                     | UI (reads `PlanRevision`)                   |
| Plan approval / feedback | `/hermes` comments                | UI buttons → endpoints                      |
| Git auth                 | installation token (HTTPS)        | SSH key, or none (scratch)                  |
| Final delivery           | draft PR                          | branch push (SSH) or downloadable workspace |
| Result acceptance        | PR review                         | UI **Accept** / **Request changes**         |

**Key reuse insight:** the _states_ don't change. `AWAITING_PLAN_APPROVAL` and
`AWAITING_PR_APPROVAL` are already generic "waiting for a human"; dashboard jobs reuse them
with different _surfaces_. No new `JobState` values, no new `TaskKind` values for jobs.

### 3.2 Repo model

- Stored as `Job.repoUrl` (SSH, e.g. `git@github.com:owner/repo.git`). Optional.
- **Provided/changed before plan approval** → next `workspace.prepare` clones it. Cheap.
- **No repo** → the agent works in a scratch `git init` workspace (greenfield). Result is a downloadable diff in the UI; a repo can be _materialised_ onto later (Phase 2).
- **Changed after IMPLEMENT** → the committed work lives in the old clone; re-targeting needs a "materialise onto new repo" step (copy files into a fresh clone + commit). v1: allow change only up to plan approval; document the harder case as Phase 2.

### 3.3 Delivery for dashboard jobs

`handleOpenPr` becomes origin-aware:

- **SSH repo** → push the job branch over SSH (no App ⇒ no PR), transition `AWAITING_PR_APPROVAL`. UI shows the pushed branch + diff with **Accept / Request changes**.
- **No repo** → nothing to push; transition `AWAITING_PR_APPROVAL`; UI shows the diff from the scratch workspace.
- **Accept** → `DONE`. **Request changes** (with a note) → `REVISING` (same as `changes_requested`: opens a new revision round and runs a scoped `REVISE`).

### 3.4 Chat is a separate subsystem

Chat is interactive and not a delivery job, so it gets its own `ChatSession`/`ChatMessage`
models and module — but **reuses** `HermesAgentService.run()` and the Langfuse SSE stream
for live responses. It does not use the job queue or the plan/verify/review loop.

---

## 4. Data model changes (`prisma/schema.prisma`)

```prisma
model Job {
  // ... existing ...
  origin         String   @default("GITHUB")   // 'GITHUB' | 'DASHBOARD'
  repoUrl        String?                        // SSH remote for dashboard jobs
  // Make GitHub-only fields optional (dashboard jobs have none):
  installationId String?                        // FK now optional
  issueNumber    Int?
  repoOwner      String?
  repoName       String?
  repoFullName   String?
  // issueTitle / issueBody are reused as the generic title / requirements body.
}
```

Notes:

- The `@@unique([repoFullName, issueNumber])` constraint still works — SQLite treats NULLs
  as distinct, so many dashboard jobs with `(null, null)` coexist. Keep it for GitHub dedup.
- `installation` relation becomes optional. Audit every `job.installation` / `repoOwner!`
  access for the now-nullable fields (TS will surface these).
- The `JobState`, `TaskKind`, and `AgentPhase` unions are unchanged for jobs. Add
  `AgentPhase 'CHAT'` for chat runs (§6).

New chat tables:

```prisma
model ChatSession {
  id        String        @id @default(cuid())
  title     String
  repoUrl   String?       // optional working repo for the session
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  messages  ChatMessage[]
}

model ChatMessage {
  id        String      @id @default(cuid())
  session   ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sessionId String
  role      String      // 'user' | 'assistant'
  content   String
  agentRunId String?    // links an assistant message to its AgentRun (for the SSE stream)
  createdAt DateTime    @default(now())
  @@index([sessionId])
}
```

---

## 5. Backend — dashboard job creation

### 5.1 Refactor: extract plan actions (mirrors the cancel/retry pattern)

Pull the approve / feedback logic out of `onIssueComment` into reusable
`OrchestratorService` methods, called by **both** the webhook and the new endpoints:

- `approvePlan(jobId, by)` → mark latest `PROPOSED` revision `APPROVED`, transition
  `IMPLEMENTING`, enqueue `IMPLEMENT`. (Today's `command.kind === 'approve'` body.)
- `submitPlanFeedback(jobId, by, body)` → create `PlanFeedback`, supersede `PROPOSED`
  revision, transition `PLANNING`, enqueue `PLAN`. (Today's feedback branch.)
- `acceptResult(jobId, by)` → transition `DONE` (dashboard analogue of PR approval).
- `requestChanges(jobId, by, body)` → store feedback, increment `revisionCycle`, transition
  `REVISING`, enqueue `REVISE` (dashboard analogue of `changes_requested`).

The webhook handlers (`onIssueComment`, `onPullRequestReview`) become thin callers, exactly
as they now are for cancel/retry.

### 5.2 New endpoints (`OrchestratorController`, `@Controller('jobs')`)

| Method  | Path                          | Body                                | Action                                                                                   |
| ------- | ----------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST`  | `/api/jobs`                   | `{ title, requirements, repoUrl? }` | Create a `DASHBOARD` job, enqueue `PLAN`, return `{ id }`                                |
| `POST`  | `/api/jobs/:id/plan/feedback` | `{ body }`                          | `submitPlanFeedback` (re-plan)                                                           |
| `POST`  | `/api/jobs/:id/plan/approve`  | —                                   | `approvePlan` → IMPLEMENT                                                                |
| `POST`  | `/api/jobs/:id/accept`        | —                                   | `acceptResult` → DONE                                                                    |
| `POST`  | `/api/jobs/:id/changes`       | `{ body }`                          | `requestChanges` → IMPLEMENT                                                             |
| `PATCH` | `/api/jobs/:id/repo`          | `{ repoUrl }`                       | set/replace repo (reject once past `AWAITING_PLAN_APPROVAL` in v1, with a clear message) |
| `GET`   | `/api/jobs/:id/diff`          | —                                   | unified diff of the job branch vs base (for the result view)                             |

Create-job validation: require non-empty `title` + `requirements`; if `repoUrl` present,
validate SSH form (`git@host:path` or `ssh://…`). All endpoints unauthenticated (localhost),
consistent with the existing UI.

`JobService.create` gains a dashboard path (origin, repoUrl, null GitHub fields). The new
endpoints live alongside cancel/retry in `OrchestratorController`.

### 5.3 Origin-aware orchestrator stages

- **`handlePlan`**: skip the GitHub issue comment and attachment download when
  `origin === 'DASHBOARD'`; everything else (clone/scratch, agent PLAN, store
  `PlanRevision`, transition `AWAITING_PLAN_APPROVAL`) is unchanged. The UI already polls
  `PlanRevision`.
- **`handleOpenPr`**: per §3.3 — SSH push or no-op, then `AWAITING_PR_APPROVAL`; only the
  GitHub path opens a draft PR and writes `PullRequestRef`.
- **PR-feedback gathering** in `handleRevise`/`handleReview` already reads `PrRevisionFeedback`;
  `requestChanges` writes to the same table so the revise loop is unchanged.

### 5.4 Workspace: SSH + scratch (`workspace.service.ts`)

Generalise the remote from "installation token over HTTPS" to a small union:

```ts
type RemoteAuth =
  | { kind: "github-app"; installationId: number; owner: string; repo: string }
  | { kind: "ssh"; url: string } // uses the configured deploy key
  | { kind: "none" }; // scratch repo, no remote
```

- `prepare`: `github-app` → today's HTTPS+token clone; `ssh` → clone `url` with
  `GIT_SSH_COMMAND="ssh -i $GIT_SSH_KEY_PATH -o StrictHostKeyChecking=accept-new"`;
  `none` → `git init` + empty initial commit + create branch.
- `push`: `github-app` → today's path; `ssh` → `git push` with the same `GIT_SSH_COMMAND`;
  `none` → no-op.
- The orchestrator picks the auth from `job.origin` + `job.repoUrl`. The in-container verify
  (`runVerify`) and commit logic are unchanged.

New config: `GIT_SSH_KEY_PATH` (optional dedicated key; unset = use the host's own SSH).

### 5.5 Result view (no-PR delivery)

`GET /api/jobs/:id/diff` returns the branch diff (reuse `workspace.branchChangedFiles` +
`git diff base...HEAD`). The UI renders it (reuse the diff renderer already in
`RunOutput.tsx`). For no-repo jobs a follow-up can add a tarball download endpoint.

---

## 6. Backend — Chat (`api/src/chat/`)

New `ChatModule` (service + controller + model), reusing `HermesAgentService` and the SSE
stream.

- `ChatService.createSession({ title, repoUrl? })`, `listSessions`, `getSession` (with
  messages), `sendMessage(sessionId, content)`.
- `sendMessage`: persist the user `ChatMessage`; spawn a Hermes run via
  `HermesAgentService.run({ phase: 'CHAT', cwd: <scratch or cloned repo>, prompt })` where
  the prompt is the assembled conversation (replay history; if Hermes session continuity is
  available, key it by `sessionId`). Tools/toolsets: full (web_fetch etc.) for research.
  Persist the assistant `ChatMessage` from the run's stdout; store `agentRunId` so the UI
  streams it live via the existing `/stream/runs/:runId`.
- Concurrency: chat runs bypass the job queue; bound them with a small semaphore so they
  don't starve worker jobs (or run on the same `WORKER_CONCURRENCY` budget).

Endpoints (`@Controller('chats')`):
| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/api/chats` | create session → `{ id }` |
| `GET` | `/api/chats` | list sessions |
| `GET` | `/api/chats/:id` | session + messages |
| `POST` | `/api/chats/:id/messages` | send user msg → `{ runId }` (UI opens SSE) |

Add `'CHAT'` to `AGENT_PHASES`. Chat is **Phase 3** — ship job creation first.

---

## 7. Frontend (`app/`)

### 7.1 Home (`JobList.tsx`)

Add **Create** and **Chat** buttons to the header (next to the "Olympian" wordmark / active
count), styled like existing buttons (e.g. Create = filled indigo, Chat = bordered zinc).
`Create` → `navigate('/create')`; `Chat` → `POST /api/chats` then `navigate('/chats/:id')`.

### 7.2 Create flow

- **Route `/create`** (new Astro page `pages/create/index.astro` + `CreateJob.tsx`): a
  composer with a **title** input, an optional **repo (SSH)** input with inline validation,
  and a **markdown requirements** textarea (with a small preview toggle — reuse the
  `marked` + `DOMPurify` already used in `RunOutput.tsx`). Submit → `POST /api/jobs` →
  `navigate('/jobs/:id')`.
- **`JobDetail.tsx` (dashboard origin)** gains a **plan-iteration thread**: render the
  requirements (issueBody) + `PlanRevision`s + `PlanFeedback` as a chronological
  conversation. While `AWAITING_PLAN_APPROVAL`: show an **Approve** button
  (`POST …/plan/approve`) and a markdown **feedback composer** (`POST …/plan/feedback`).
  Add a **repo** control (show/edit `repoUrl`, `PATCH …/repo`) when editable.
- **Result view**: when `AWAITING_PR_APPROVAL` on a dashboard job, render the diff
  (`GET …/diff`) with **Accept** (`POST …/accept`) and **Request changes**
  (`POST …/changes`) — the dashboard analogue of the PR controls. (GitHub jobs keep the PR
  link as today.)

### 7.3 Chat flow (Phase 3)

- **Route `/chats/:id`** (`pages/chats/index.astro` + `Chat.tsx`): message list (user +
  assistant, markdown-rendered), a composer, and an optional repo field. On send →
  `POST …/messages` → open `EventSource('/stream/runs/:runId)` to stream the assistant's
  live activity (reuse the `RunOutput` event rendering), then show the final message.

### 7.4 SPA routing

Extend `interface.utility.ts` fallbacks for `/create` and `/chats/:id` (mirroring the
existing `/jobs/:id` and `/jobs/:id/runs/:runId` rewrites), and add the matching Astro pages
so the static build emits their shells. Client routing in each component reads
`window.location.pathname` as the others do.

---

## 8. Reuse map

| Capability                               | Reused as-is                  | Needs an origin/mode branch            |
| ---------------------------------------- | ----------------------------- | -------------------------------------- |
| PLAN/IMPLEMENT/VERIFY/REVISE/REVIEW loop | ✓                             | —                                      |
| `HermesAgentService.run`, Langfuse SSE   | ✓ (jobs **and** chat)         | —                                      |
| `PlanRevision` / `PlanFeedback`          | ✓ (becomes the create "chat") | —                                      |
| `PrRevisionFeedback` + revise loop       | ✓                             | `requestChanges` writes to it          |
| cancel / retry                           | ✓                             | —                                      |
| Job states & task kinds                  | ✓                             | —                                      |
| `handlePlan`                             | mostly                        | skip comment/attachments for dashboard |
| `handleOpenPr`                           | partly                        | SSH push / no-op vs draft PR           |
| `workspace.prepare/push`                 | partly                        | SSH / scratch auth                     |
| Plan approve / feedback / accept         | extract to methods            | called by webhook + UI                 |

---

## 9. Security

- Endpoints stay **unauthenticated** (localhost), matching the current UI. If exposed, gate
  `/api/*` behind a token/IP guard (already flagged in §11 of the old spec).
- **SSH key** (`GIT_SSH_KEY_PATH`) is powerful — it can push to any repo it's
  authorised for. Mount it read-only; never expose it to the agent container (git runs on
  the orchestrator host/`workspace.service`, not inside the agent sandbox — keep it that
  way). Use `StrictHostKeyChecking=accept-new` with a persistent `known_hosts`.
- Dashboard requirements are user-authored markdown fed to the agent — same prompt-injection
  surface as a GitHub issue body; no new exposure.

---

## 10. Open questions / decisions to confirm

1. **No-repo deliverable**: diff view only (v1), or also a downloadable tarball? (Plan
   assumes diff first.)
2. **Repo change after IMPLEMENT**: block in v1 (require cancel + recreate), or build the
   "materialise onto a fresh clone" path? (Plan assumes block-with-message in v1.)
3. **Dashboard → real PR**: out of scope (SSH push only). Revisit if you want App-token PRs
   for repos the App is installed on.
4. **Chat continuity**: Hermes native sessions vs history-replay — confirm CLI session
   support before choosing (Plan assumes history-replay as the safe default).

---

## 11. Phasing & checklist

**Phase 1 — Dashboard job creation (no repo + SSH repo).**

1. Schema: `Job.origin`, `Job.repoUrl`, nullable GitHub fields; migrate.
2. Orchestrator: extract `approvePlan` / `submitPlanFeedback` / `acceptResult` /
   `requestChanges`; make `handlePlan` / `handleOpenPr` origin-aware.
3. Workspace: `RemoteAuth` union (github-app / ssh / none); `GIT_SSH_KEY_PATH`.
4. Endpoints: create job, plan feedback/approve, accept/changes, repo PATCH, diff.
5. Orchestrator service tests for the new methods + origin branches (extend the existing
   `orchestrator.service.spec.ts` harness).
6. UI: Create button + `/create` composer; `JobDetail` plan-thread + Approve + feedback +
   repo control + result/diff view; SPA fallbacks.

**Phase 2 — Repo flexibility.** Attach-repo-later + "materialise onto repo"; no-repo tarball
download.

**Phase 3 — Chat.** `ChatModule` (+ `'CHAT'` phase), endpoints, `/chats/:id` UI streaming
via the existing SSE pipeline; **Chat** button on home.

> Build order rule: land Phase 1 behind the existing pipeline (maximum reuse, minimum new
> state) before starting Chat, which is the only genuinely new subsystem.
