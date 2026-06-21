# Olympian Roadmap

Where the service is, and how to take it to the next level. Status tags: **✅ shipped**,
**◑ partial**, **▢ planned**.

---

## Where we are today

Olympian is a working dark factory. A labelled GitHub issue (or a dashboard-created job) flows
through a deterministic, DB-backed state machine; a human only approves the plan and the final
PR.

```
issue ─▶ PLAN ─▶ (approve) ─▶ IMPLEMENT ─▶ JUDGE ─▶ VERIFY ─▶ SELF-REVIEW ─▶ OPEN DRAFT PR ─▶ (approve) ─▶ DONE
                                  ▲          │ │                   │              │
                                  │   (not met) │                  │              │
                                  └── REVISE ◀──┴──────────────────┴──────────────┘
                                       ▲  (verify OR review fails, or unaddressed PR feedback)
                                       └─ JUDGE loop (re-run with critique)
```

The quality and reliability foundations are solid:

- **Ground-truth VERIFY stage.** The repo's tests/build are discovered per-repo by the agent,
  then **executed by the orchestrator inside the agent's own container image** from a clean
  install — non-spoofable. Failures route to REVISE; a single retry absorbs transient flakes.
- **Completion judge (Hermes `/goal` pattern).** ✅ After each IMPLEMENT/REVISE pass a
  review-grade model judges whether the plan's acceptance criteria are actually met; if not, the
  agent is **re-run in the same workspace with the judge's critique as its to-do list** (up to
  `MAX_COMPLETION_RETRIES`). A hard gate at OPEN_PR also loops back to REVISE if reviewer
  feedback arrived but hasn't been through a work pass — so a PR can't reach "awaiting approval"
  with unaddressed changes. Judge runs are first-class (`phase: JUDGE`, a `judgeMet` verdict
  column, and a dedicated critique page in the UI).
- **Rubric-based review** with an **independent reviewer model** (Qwen3.6:27b reviewing
  Qwen3.6:35b). The gate is the rubric (correctness / tests / plan-coverage / security) plus no
  high/critical issues — confidence is advisory.
- **Test-first IMPLEMENT.** ✅ IMPLEMENT writes an automated test per acceptance criterion
  *before* the implementation (scaffolding a runner if the repo has none), confirms it fails for
  the right reason, then iterates to green — and VERIFY runs those tests as the gate.
- **Unified failure loop.** Every post-implement failure (judge, verify, or review) funnels
  through REVISE → VERIFY → REVIEW, with per-cycle caps that fall back to a human-reviewed draft.
- **Honest run accounting.** Premature/garbage exits are caught (no-op-commit detection,
  output-length guard, and a strengthened autonomy/completion contract) and recorded as FAILED.
  Review and PR feedback persist per-cycle; a wasted cycle never loses context. Attachments on
  the issue **and** PR feedback are downloaded locally for PLAN, IMPLEMENT, and REVISE.
- **Tunable model tiers.** ✅ Primary, reviewer, **auxiliary** (compression / vision /
  web-extract), and **judge** models/providers are independently configurable. Auxiliary call
  timeouts are raised for slow local inference (the 30s default was killing long runs at the
  compression boundary).
- **Live observability.** The run view streams the agent's Langfuse activity, shows a
  **trace-aware context meter and context-compression markers** (distinguishing real
  compression from `delegate_task` boundaries), and **seamlessly follows the run** as the judge
  restarts it. `LANGFUSE_DEBUG_SPANS` dumps raw span shapes for diagnosis.
- **Dashboard control surface.** ✅ Approve-plan, cancel, and retry from the UI (mirroring the
  `/hermes` commands), plus per-run output and judge-critique pages.
- **Clean module architecture.** One module per work phase (`planning`, `implement`, `revise`,
  `verify`, `review`, `summary`, `judge`) over shared infra (`agent`, `workspace`,
  `orchestrator`, `queue`, `worker`, `job`, `github`, `webhook`, `langfuse`, `metrics`, `config`).

The bottleneck is no longer "does it produce good code on a happy path" — it does, and it now
self-checks completion. The next level is about three things: **knowing** quality
systematically, **running unattended** without silent failure, and **handling harder, bigger
work**.

---

## Guiding principles

Invariants that got us here; new work should preserve them.

1. **Ground truth over self-report.** Gate on executed tests and observed diffs. (VERIFY is
   non-spoofable; review/judge confidence is advisory.)
2. **Measure before optimising.** Prompt/model changes should move a tracked number.
3. **Persist state; rebuild prompts deterministically.** Prisma is the source of truth; a crash
   mid-stage loses no decision.
4. **Keep the two human gates** (plan, final PR) and make everything between them legible.
5. **Fail loudly and recoverably**, never silently.

---

## Pillar A — Measure & systematically improve (the keystone)

Output quality is good *anecdotally* and now self-judged, but it's still not a number you can
move. This pillar is the prerequisite for trusting any model/prompt change.

### A1. Evaluation harness / regression suite — ▢ _effort: L, payoff: very high_
A curated set of issues (varied difficulty, languages, repo sizes), each with a scored expected
outcome, run through the **full pipeline headless** and graded: did it open a PR, did VERIFY
pass, how many cycles to green, **planted-bug recall** (seed defects, measure REVIEW catches),
and cost (tokens from the Langfuse traces we already ingest, plus wall-clock per stage). Build
it as a script that seeds `Job` rows and drives `OrchestratorService` against fixture repos,
asserting on the resulting `ReviewPass` / `VerifyRun` / `AgentRun` / PR records. **Still the
single highest-leverage item on this roadmap.**

### A2. Per-job cost & latency accounting — ◑ _effort: M, payoff: high_
Groundwork shipped: token usage arrives in the Langfuse OTLP spans and the live view already
renders a per-run context meter, tok/s, and compression count. **Remaining:** aggregate tokens
+ wall-clock + cycle counts **per `AgentRun`/`Job`**, persist them, and surface in the UI and
Prometheus so the 35b/27b/aux split and time-per-stage are reasonable about.

### A3. Model & prompt experimentation — ◑ _effort: M, payoff: high_
Already done by hand (e.g. trialling auxiliary compression models). Formalise with a
config-level switch per experiment + an eval run (needs A1) so models/prompts are picked by
score, not feel.

### A4. Real-run outcome telemetry — ▢ _effort: M, payoff: medium_
PR change-requests are now *captured* (recorded + folded back in), but the **rate** isn't
tracked. Track: review-catch-rate per cycle, VERIFY failure reasons, judge not-met rate, and the
**human-PR-change-request rate** — the ground truth for reviewer quality — and feed it back into
the review prompt/model choice.

---

## Pillar B — Run unattended without silent failure

### B1. Durable webhook handling — ▢ _effort: M, payoff: very high_  ⚠️ biggest reliability gap
The controller returns `202` then `void this.webhooks.dispatch(...)` — fire-and-forget. GitHub
won't redeliver after a `202`, so a crash between response and completion **loses the event**
and strands the job. Add a catch-up reconciler (the app already imports `@nestjs/schedule`) that
re-dispatches `WebhookEvent` rows with `processedAt IS NULL`, plus a metric on unprocessed age.
> Note: the dashboard's approve/cancel/retry buttons now provide a manual escape hatch for the
> plan gate, but PR approval and review comments still depend entirely on webhooks.

### B2. Parked-job reconciliation — ◑ _effort: M, payoff: high_
Hardened on the PR side: a second changes-request mid-cycle is recorded + acknowledged, and the
OPEN_PR gate refuses to present a PR with unaddressed feedback. **Remaining:** a periodic GitHub
poll for new comments/reviews on parked jobs as a backstop to B1, a "stale job" metric, and
fixing the parallel guard in `onPrReviewComment` (still drops inline comments that arrive
mid-cycle — same bug we just fixed in `onPullRequestReview`).

### B3. Workspace garbage collection — ▢ _effort: S, payoff: medium_
`workspace.cleanup` runs only on the `DONE` path — `FAILED`, `CANCELLED`, and re-labelled jobs
leak their clones (and `node_modules`). Clean up on all terminal transitions, add a periodic
sweep with a retention cap, and keep the shared `.npm-cache` out of GC.

### B4. Installation-token hardening — ▢ _effort: M, payoff: high (security)_
The installation token is written into `.git/config` in the bind-mounted workspace, which the
`--yolo` agent (driven partly by untrusted issue/comment text) can read. Strip the token from
the remote for agent and verify runs (tokenless URL), re-injecting only in the orchestrator's
`push`.

### B5. Service-level tests for the brain — ◑ _effort: M, payoff: high_
`OrchestratorService` is now well covered (`orchestrator.service.spec.ts`): stage routing,
per-cycle caps, the judge continuation loop, no-op/incomplete handling, cancel/retry/approve,
PR-review recording, and the OPEN_PR "unaddressed feedback → REVISE" gate. **Remaining:**
`QueueService` (atomic claim, reclaim/heartbeat) and `WorkspaceService` (clone/commit/push,
in-container verify) are still only exercised via the e2e test.

### B6. Alerting on the metrics we already emit — ▢ _effort: S, payoff: medium_
Prometheus metrics exist but nothing watches them. Alert on stuck/parked jobs, rising
REVISE-loop / VERIFY-flake / judge-not-met rates, queue depth, and orphaned containers.

### B7. Horizontal scale, when you need it — ▢ _effort: L, payoff: situational_
Single-process / single-SQLite is a vertical ceiling. The queue claim is concurrency-safe
(`UPDATE … RETURNING`), so the path is: SQLite → Postgres, N worker processes, and
**per-installation fairness**. Only worth it past a handful of concurrent jobs.

---

## Pillar C — Handle harder and bigger work

### C1. Test-stub-driven implementation (TDD) — ✅ (core) / ◑ (variant)
Shipped as **test-first IMPLEMENT**: tests are written first, confirmed failing, then driven to
green under the VERIFY gate. The roadmap's original framing — PLAN emitting failing stubs that
are committed before IMPLEMENT — is the remaining variant; worth doing only if the eval harness
(A1) shows it improves coverage over the current in-IMPLEMENT approach.

### C2. Cross-job repo memory (Hermes skills) — ▢ _effort: M, payoff: high_
After a successful job, distil repo knowledge (test command, layout, conventions, gotchas) into
a Hermes **skill** at `HERMES_HOME/skills/<repo>/` (already bind-mounted) and load it on future
jobs → faster orientation, fewer cycles. Also lets the discovered VERIFY command become durable
knowledge instead of being re-discovered per cycle.

### C3. Large-issue decomposition — ▢ _effort: L, payoff: high (for big issues)_
For multi-file issues, have PLAN split into independent sub-tasks, each implemented + verified,
then integrated and verified as a whole. Bound by a depth/cost cap.

### C4. Repo retrieval / indexing for exploration — ▢ _effort: M, payoff: medium_
The delegate-exploration pattern is good but grep-based. An embedded symbol+semantic index makes
file location faster/cheaper/more accurate — most valuable on large repos.

### C5. Reviewer ensemble & graceful escalation — ▢ _effort: M, payoff: medium_
- For high-stakes repos, an optional N-reviewer majority vote (diverse lenses) instead of one
  pass. (The completion judge is a single evaluator, not an ensemble.)
- When a cap is hit, produce a structured **"blocked" report** (what was attempted, failing
  verify output, unresolved issues) instead of a low-quality draft PR.

### C6. Richer PR & human-in-the-loop — ◑ _effort: M, payoff: medium_
Shipped: the PR body already carries test evidence (what VERIFY ran + pass/fail), advisory
confidence, failing checks, and unresolved findings; inline PR comments are captured with
path/line and fed to REVISE; the dashboard approves plans and exposes the per-run + judge-
critique decision trail. **Remaining:** post replies **at the specific PR line** (not just the
thread), "approve plan *with edits*" in the UI, and surfacing the full rubric/verify trail more
prominently.

---

## Suggested sequencing

**Phase 1 — Measure + stop the bleeding.**
A1 eval harness · A2 cost/latency aggregation · B1 webhook durability · B3 workspace GC.
> Then quality is a number you can move, and the factory survives a restart.

**Phase 2 — Harden the rest.**
B2 reconciliation (+ the `onPrReviewComment` guard) · B4 token hardening · B5 Queue/Workspace
tests · C2 repo memory · A3 experimentation · A4 outcome telemetry.

**Phase 3 — Scale + frontier.**
C3 decomposition · C4 retrieval · C5 ensemble/escalation · C6 inline-comment replies ·
B6 alerting · B7 Postgres/horizontal scale (only if throughput demands it).

The throughline is unchanged: **A1 first.** Most other items are easier to prioritise and
justify once there's a score to move — and now that the pipeline self-judges completion, a
harness can grade it end-to-end with little babysitting.
