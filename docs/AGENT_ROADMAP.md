# Olympian Roadmap

Where the service is, and how to take it to the next level. This replaces the
pre‑VERIFY‑stage roadmap entirely — most of that work is now shipped.

---

## Where we are today

Olympian is a working dark factory. A labelled GitHub issue flows through a
deterministic, DB‑backed state machine, and a human only approves the plan and the
final PR.

```
issue ─▶ PLAN ─▶ (approve) ─▶ IMPLEMENT ─▶ VERIFY ─▶ SELF‑REVIEW ─▶ OPEN DRAFT PR ─▶ (approve) ─▶ DONE
                                  ▲           │            │
                                  └── REVISE ◀┴────────────┘   (verify OR review fails)
```

The quality and reliability foundations are solid:

- **Ground‑truth VERIFY stage.** The repo's tests/build are discovered per‑repo by the
  agent, then **executed by the orchestrator inside the agent's own container image** from
  a clean install — non‑spoofable, and immune to the host/container divergence that
  produced false failures. Failures route to REVISE; a single retry absorbs transient
  flakes.
- **Rubric‑based review** with an **independent reviewer model** (currently Qwen3.6:27b
  reviewing Qwen3.6:35b's work). The gate is the rubric (correctness / tests /
  plan‑coverage / security) plus no high‑critical issues — confidence is advisory, not the
  gate.
- **Unified failure loop.** Every post‑implement failure (verify or review) funnels through
  REVISE → VERIFY → REVIEW, with per‑cycle caps that fall back to a human‑reviewed draft PR.
- **Honest run accounting.** Premature/garbage exits are caught (length guard + no‑op‑commit
  detection) and recorded as FAILED, not phantom successes. Review feedback persists
  per‑cycle, so a wasted cycle never loses context.
- **Context discipline.** IMPLEMENT and REVISE delegate file exploration to read‑only
  subagents and drive todo lists (which survive Hermes compaction); REVIEW reads targeted
  windows. Plans are grounded (hallucinated paths flagged) and scope‑checked (out‑of‑plan
  edits surfaced to the reviewer).
- **Clean module architecture.** One module per work phase (`planning`, `implement`,
  `revise`, `verify`, `review`, `summary`) over shared infra (`agent`, `workspace`,
  `orchestrator`, `queue`, `worker`, `job`, `github`, `webhook`, `langfuse`, `metrics`).

The bottleneck is no longer "does it produce good code on a happy path" — it does. The next
level is about three things: **knowing** quality systematically, **running unattended**
without silent failure, and **handling harder, bigger work**.

---

## Guiding principles

These are the invariants that got us here; new work should preserve them.

1. **Ground truth over self‑report.** Gate on executed tests and observed diffs, never on
   the agent's word. (VERIFY is non‑spoofable; review confidence is advisory.)
2. **Measure before optimising.** Prompt/model changes should move a tracked number, not a
   vibe.
3. **Persist state; rebuild prompts deterministically.** Prisma is the source of truth; a
   crash mid‑stage loses no decision.
4. **Keep the two human gates** (plan, final PR) and make everything between them legible.
5. **Fail loudly and recoverably**, never silently.

---

## Pillar A — Measure & systematically improve (the keystone)

Output quality is good *anecdotally*. To take it to the next level you have to make it a
number you can move. Everything in Pillars B and C is easier to justify once this exists.

### A1. Evaluation harness / regression suite — _effort: L, payoff: very high_
A curated set of issues (varied difficulty, languages, repo sizes), each with a scored
expected outcome, run through the **full pipeline headless** and graded:
- Did it open a PR? Did VERIFY pass? How many cycles to green?
- **Planted‑bug recall:** seed known defects and measure how many REVIEW catches.
- Cost: tokens (from the Langfuse traces we already ingest) and wall‑clock per stage.

This converts "it's catching lots of issues" into a tracked pass‑rate + recall + cost. It's
the prerequisite for trusting any model/prompt change, and the single highest‑leverage item
on this roadmap. Build it as a script that seeds `Job` rows and drives `OrchestratorService`
against fixture repos, asserting on the resulting `ReviewPass` / `VerifyRun` / PR records.

### A2. Per‑job cost & latency accounting — _effort: M, payoff: high_
Surface tokens, wall‑clock, and cycle counts per job and per stage, in the UI and in
Prometheus. We already receive token usage in the Langfuse OTLP spans (`langfuse.utility`);
aggregate it per `AgentRun`/`Job`. Without this you can't reason about the 35b/27b split or
about where time goes.

### A3. Model & prompt experimentation — _effort: M, payoff: high_
With A1 + A2, formalise what you're already doing by hand: A/B the primary/reviewer models
and prompt variants and pick by score, not feel. A config‑level switch per experiment plus
an eval run is enough; no framework needed initially.

### A4. Real‑run outcome telemetry — _effort: M, payoff: medium_
Track signals only production gives you: review‑catch‑rate per cycle, VERIFY failure
reasons, and crucially the **human‑PR‑change‑request rate** (what review missed but a human
caught). That last number is the ground truth for reviewer quality and should feed back into
the review prompt/model choice.

---

## Pillar B — Run unattended without silent failure

The pipeline is correct, but a few boundaries can still strand a job quietly. These are what
stand between "works while I watch it" and "runs the factory while I sleep."

### B1. Durable webhook handling — _effort: M, payoff: very high_  ⚠️ biggest reliability gap
The controller returns `202` then `void this.webhooks.dispatch(...)` — fire‑and‑forget.
`WebhookEvent.processedAt` is only set on success, but GitHub won't redeliver after a `202`,
so a crash/restart between the response and completion **loses the event** and strands the
job (a missed `/hermes approve` or PR approval sits forever). Add a catch‑up reconciler
(the app already imports `@nestjs/schedule`) that periodically re‑dispatches
`WebhookEvent` rows with `processedAt IS NULL`, plus a metric on unprocessed age.

### B2. Parked‑job reconciliation — _effort: M, payoff: high_
Jobs in `AWAITING_PLAN_APPROVAL` / `AWAITING_PR_APPROVAL` depend entirely on a webhook
arriving. Add a periodic poll of GitHub for new comments/reviews on parked jobs (since
`updatedAt`) as a backstop to B1, and a "stale job" metric so a stall is visible instead of
invisible.

### B3. Workspace garbage collection — _effort: S, payoff: medium_
`workspace.cleanup` is only called on the PR‑approved (`DONE`) path — `FAILED`, `CANCELLED`,
and re‑labelled jobs leak their clones (and now `node_modules`) indefinitely. Clean up on all
terminal transitions, add a periodic sweep with a retention cap, and keep the shared
`.npm-cache` (already added) out of GC.

### B4. Installation‑token hardening — _effort: M, payoff: high (security)_
The short‑lived installation token is written into `.git/config` inside the bind‑mounted
workspace, which the `--yolo` agent — driven partly by untrusted issue/comment text — can
read and exfiltrate. Strip the token from the remote for the duration of agent and verify
runs (tokenless URL), and re‑inject it only in the orchestrator's `push`. Pairs naturally
with the now‑containerised verify.

### B5. Service‑level tests for the brain — _effort: M, payoff: high_
Every `*.service.ts` is currently untested — only pure utilities have specs. The 1200‑line
`OrchestratorService` (stage routing, caps, the VERIFY↔REVISE↔REVIEW loop) is the
highest‑regression‑risk code in the repo. Add tests around: stage transitions, the
per‑cycle caps, no‑op/incomplete handling, and the "review feedback + verify failure both
reach REVISE" invariant. Also cover `QueueService` (atomic claim, reclaim) and
`WorkspaceService`.

### B6. Alerting on the metrics we already emit — _effort: S, payoff: medium_
Prometheus metrics exist but nothing watches them. Add alerts for stuck/parked jobs, rising
REVISE‑loop or VERIFY‑flake rates, queue depth, and orphaned containers.

### B7. Horizontal scale, when you need it — _effort: L, payoff: situational_
Single‑process / single‑SQLite is a vertical ceiling. The queue claim is already
concurrency‑safe (`UPDATE … RETURNING`), so the path is: swap SQLite → Postgres, run N
worker processes, and add **per‑installation fairness** so one busy repo can't starve the
others (today claiming is global FIFO by priority). Only worth it past a handful of
concurrent jobs.

---

## Pillar C — Handle harder and bigger work

Once you can measure (A) and trust it unattended (B), push the capability frontier.

### C1. Test‑stub‑driven implementation (TDD) — _effort: M, payoff: high_
Have PLAN emit acceptance criteria as **failing test stubs**, commit them first, and let the
existing VERIFY stage run them — IMPLEMENT/REVISE iterate until green. This replaces
self‑reported progress with an executable, ground‑truth signal and leans directly on the
VERIFY machinery we now have. The strongest single quality lever after the eval harness.

### C2. Cross‑job repo memory (Hermes skills) — _effort: M, payoff: high_
After a successful job, distil what the agent learned about the repo (test command, module
layout, conventions, gotchas) into a Hermes **skill** written to
`HERMES_HOME/skills/<repo>/` (already bind‑mounted into every container). Load it at the
start of future jobs on that repo → faster orientation, fewer cycles, less exploration
token spend. Also lets a discovered VERIFY command be cached as durable knowledge.

### C3. Large‑issue decomposition — _effort: L, payoff: high (for big issues)_
For issues spanning many files, have PLAN split into independent sub‑tasks, each
implemented + verified, then integrated and verified as a whole. Bound by a depth/cost cap
so a two‑level tree can't blow the token budget. Turns "too big for one context" into
tractable units.

### C4. Repo retrieval / indexing for exploration — _effort: M, payoff: medium_
The delegate‑exploration pattern is good but still grep‑based. An embedded index of the repo
(symbols + semantic) makes file location faster, cheaper, and more accurate — most valuable
on large repos where grep exploration dominates cost.

### C5. Reviewer ensemble & graceful escalation — _effort: M, payoff: medium_
- For high‑stakes repos, an optional N‑reviewer majority vote (diverse lenses:
  correctness / security / tests) instead of a single pass.
- When a cap is hit, produce a structured **"blocked" report** (what was attempted, the
  failing verify output, unresolved review issues) instead of a low‑quality draft PR — so
  the human gets a useful handoff, not noise.

### C6. Richer PR & human‑in‑the‑loop — _effort: M, payoff: medium_
- PR body with risk callouts + test evidence (what VERIFY ran, what passed).
- Respond to **inline** PR review comments at the specific line, not just the thread.
- "Approve plan with edits" in the UI, and surface the rubric/verify decision trail so a
  human can see *why* it passed.

---

## Suggested sequencing

**Phase 1 — Foundation (measure + stop the bleeding).**
A1 eval harness · A2 cost/latency · B1 webhook durability · B3 workspace GC.
> After this you can prove quality moves, and the factory survives a restart.

**Phase 2 — Harden + first capability gains.**
B2 reconciliation · B4 token hardening · B5 orchestrator tests · C1 test‑stubs · C2 repo
memory · A3 experimentation.
> Unattended‑safe, and measurably better per cycle.

**Phase 3 — Scale + frontier.**
C3 decomposition · C4 retrieval · C5 ensemble/escalation · C6 human‑loop · B6 alerting ·
B7 Postgres/horizontal scale (only if throughput demands it).

The throughline: **A1 first.** Almost every other item is easier to prioritise, justify, and
verify once there's a score to move.
