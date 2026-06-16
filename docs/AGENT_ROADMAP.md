# Agent Loop Roadmap

Techniques identified for improving agent reliability, context efficiency, and task completion. Items marked **implemented** are already in the codebase. The rest are ordered roughly by value-to-effort ratio.

---

## Implemented

| Technique                                                            | Where                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| Context compaction with tuned threshold (80%) and pinned plan        | `api/.hermes/config.yaml`                        |
| Post-compaction full-plan recovery instruction                       | `IMPLEMENT_OUTPUT_CONTRACT`                      |
| MCP memory checkpointing (`memory_set`/`memory_get` per file)        | `api/src/memory/`, `agent.prompts.ts`            |
| Hard exit guard (no exit until all plan items are `"done"`)          | `IMPLEMENT_OUTPUT_CONTRACT`, `buildRevisePrompt` |
| Grep-first file reading (read only relevant 20–40 line windows)      | `IMPLEMENT_OUTPUT_CONTRACT`                      |
| Per-file L1 scratch note (`.olympian/current-task.md`)               | `IMPLEMENT_OUTPUT_CONTRACT`                      |
| Incremental static analysis gate (run after each file, not just end) | `IMPLEMENT_OUTPUT_CONTRACT`                      |
| Subagent exploration delegation via `delegate_task` (fresh sessions) | `buildImplementPrompt`                           |
| REVISE memory checkpointing (`fix:<n>` keys per review issue)        | `buildRevisePrompt`                              |
| 200-char stdout minimum guard (catches confused agent exits)         | `orchestrator.service.ts`                        |
| No-git, no-clone instruction in all agent phases                     | `agent.prompts.ts`                               |
| Batch tool call warning                                              | `IMPLEMENT_OUTPUT_CONTRACT`                      |

---

## Near-term (prompt or config changes only)

### Speculative plan pre-expansion

Before writing any file, the agent produces the exact function signatures, types, and imports it intends to write for each plan item — a ~500 token expansion that dramatically reduces mid-implementation drift.

**Implementation**: add to `buildImplementPrompt` after exploration delegation — instruct the agent to write a `.olympian/signatures.md` sketch before any real files.

---

### Cross-session learning via Hermes skills

After a successful job, the orchestrator triggers a skill-creation step: the agent summarises what it learned about the target repo's patterns (testing conventions, module structure, naming) into a Hermes skill file. This skill is loaded at the start of subsequent jobs against the same repo, reducing exploration time and context usage for repeat tasks.

**Implementation**: new `POST /api/agent/skill` orchestrator step after `DONE`; skill written to `HERMES_HOME/skills/<repoFullName>/`.

---

## Medium-term (schema or code changes required)

### Acceptance criteria as runnable test stubs

The plan schema gains a `## Test Stubs` section. Before any implementation, the agent writes failing test stubs matching each acceptance criterion. It implements until all stubs pass. This replaces self-reported progress with a ground-truth executable signal.

**Implementation**: update `PLAN_REQUIRED_SECTIONS` and `PLAN_OUTPUT_CONTRACT`; add a test-stub writing step to `handleImplement` before the main agent loop; use `VERIFY_COMMAND` to run stubs.

---

### FastContext integration (separate exploration model)

[Microsoft FastContext](https://github.com/microsoft/fastcontext) (June 2026) is a lightweight read-only exploration subagent trained specifically for repository navigation. It accepts a natural-language query and returns compact `<final_answer>` file:line citations.

Results: up to **+5.5 score improvement** and **60.3% fewer main-agent tokens** on SWE-bench.

**Requirements**:

- A second Ollama model for exploration (4B–7B — `qwen2.5-coder:7b` or a served FastContext weight from `microsoft/swe-fastcontext` on HuggingFace)
- `fastcontext` CLI installed in `Dockerfile.agent`
- Orchestrator runs `fastcontext --query "..." --citation` before `handleImplement`, passes output as `ctx.attachments`
- Separate `FASTCONTEXT_BASE_URL` / `FASTCONTEXT_MODEL` env vars

**Where the current `delegate_task` approach falls short**: it uses the same large model and consumes the same per-token cost. FastContext's trained 4B model is ~8× cheaper per token and purpose-built for navigation.

---

### Tool output compression middleware

Large `read_file` responses are the biggest single source of context drain. A middleware layer post-processes every tool response over N tokens through a summarizer before it enters the agent's context, replacing raw file content with annotated excerpts.

**Implementation**: Hermes context engine plugin (`plugins/context_engine/`) that intercepts tool results and truncates/summarises them. Alternatively, a NestJS proxy that wraps the Ollama endpoint and applies compression to assistant turns before they are returned.

---

## Research / long-term

### Process Reward Models (PRMs)

Instead of a binary PASS/FAIL verdict from the self-reviewer, a PRM scores each intermediate commit: _"is this diff moving toward the goal?"_ This replaces `confidence >= threshold` with a richer, step-level signal and enables early termination of runs that are drifting.

**Status**: requires a fine-tuned model; no off-the-shelf solution for arbitrary codebases yet. Watch the SWE-bench leaderboard for open PRM releases.

---

### Hierarchical orchestration (orchestrator + leaf agents)

For very large issues (50+ files), the plan is decomposed into independent sub-problems. An orchestrator agent (Hermes `role="orchestrator"`) delegates each sub-problem to a leaf agent with a focused sub-plan. Results are merged and integration-tested by the orchestrator.

**Configuration prerequisite**: `delegation.max_spawn_depth: 2` in `config.yaml`.

**Consideration**: at `max_concurrent_children: 3`, a two-level tree can run 9 parallel leaf agents, multiplying token spend significantly. Only worthwhile for genuinely decomposable tasks.

---

### Episodic memory with vector retrieval

For organisations running many jobs, a vector store of past agent trajectories enables semantic retrieval: _"find jobs where we encountered a similar TypeScript error and how it was fixed."_ This surfaces relevant prior experience without manual prompt engineering.

**When it pays off**: when the same codebase accumulates 50+ jobs. At smaller scale, the SQLite `AgentMemory` key-value store is sufficient. The `AgentMemory` table is already in place as a foundation — adding an embedding column via `sqlite-vec` is the incremental step.
