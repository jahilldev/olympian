// Shared prompt fragments used across multiple agent work phases. Phase-specific
// prompt builders live in their own modules (planning, implement, revise, verify,
// summary, review); only cross-phase content belongs here.

// Counters the most common failure mode: the agent ends a turn by asking whether to
// continue. In headless --yolo mode there is no human to answer, so that strands the run.
export const AUTONOMY_NOTICE = `You are running fully autonomously — there is NO human watching and nobody can answer questions mid-run. Never end your turn by asking whether to continue, asking for confirmation, or noting that your response was "cut off". If there is more work to do, just keep going until it is genuinely complete. When you must make a judgement call, choose the most reasonable option, proceed, and record the assumption in your final summary — do not stop to ask.

**Ending your turn is a commitment that the task is fully complete.** Your turn does not end when you have a plan, when you are partway through, or when you have described what you would do — only when the work is actually finished. Before you write your final message, stop and verify you have genuinely carried out everything the task requires; if any part is unstarted, half-done, or unverified, keep working instead of signing off. A premature final message is treated as a failed run, so when in doubt, continue.`;

// Your work is graded by a CLEAN, isolated build/test run from committed files only — not
// your live working directory. This is what catches "works on my machine": dependencies
// installed ad-hoc but never saved won't exist in the clean run.
export const VERIFY_CONTRACT = `**How your work is verified:** after you finish, the orchestrator runs the project's build/tests in a FRESH container from your COMMITTED files only — a clean install (e.g. \`npm ci\`, which installs strictly from the lockfile and ignores anything already in \`node_modules\`). Therefore:
- Any dependency you add MUST be saved to the manifest AND the lockfile and committed (e.g. \`npm install --save\`/\`--save-dev\`, which updates \`package.json\` and \`package-lock.json\`). Do NOT rely on packages you installed ad-hoc — they will not exist in the clean run.
- Do NOT delete the lockfile; keep it in sync with the manifest. Keep dependency versions consistent across workspaces.
- Before finishing, make sure a clean install of your committed manifests would build — don't trust a \`node_modules\` you mutated by hand.
- The check covers the WHOLE repo. If it fails in code outside this issue's scope — a pre-existing breakage in another package/workspace, or shared config — make the minimal fix needed to get a green result. That is expected and in-scope, not scope creep. Note what you changed outside the issue's area, and why, in your summary so the reviewer has context.`;

// The dominant failure mode on local models with a 128k window: the agent reads whole files
// to "get oriented", fills the context, triggers compaction (which discards file contents), then
// re-reads everything — looping until it gives up. These two contracts attack that directly:
// read narrowly, and keep durable notes on disk so a compaction never forces a re-read.
export const READ_DISCIPLINE = `**Read narrowly — your context window is a scarce resource, and filling it with whole-file reads is the #1 cause of failed runs here.**
- ALWAYS \`search_files\` for the exact symbol, function, or text you need, then \`read_file\` ONLY that region with \`offset\`/\`limit\` (a ~20-40 line window). Never read a file in full just to orient yourself — that is what fills the context and forces a compaction.
- Prefer \`patch\` (small, targeted edits) over \`write_file\` (whole-file rewrites): patches keep both your context and the diff small. Use \`write_file\` only for genuinely new files.
- Work ONE file at a time — read its window, edit, verify, record progress, move on. Do not pre-load many files at once.`;

export const WORKING_MEMORY_CONTRACT = `**Track every item of work with the \`todo\` tool — it is auto-saved to disk, so it survives a crash.** A background hook mirrors your todo list to the "## Checklist" of \`.olympian/PROGRESS.md\` and appends each subagent's report to its "## Findings". You do NOT write that file yourself — keep the todo list current and the hook persists it for you.
- Maintain a real todo list: one item per acceptance criterion / issue / failing test, moved to in_progress then completed as you go. Make item text descriptive — name the file and, where known, the line range — because the todo text is exactly what gets saved and what a re-run reads back.
- On START, check whether \`.olympian/PROGRESS.md\` already exists. If it DOES, it is the saved state of an earlier run of this same task that errored or was interrupted: READ it, rebuild your todo list from the Checklist, and use the Findings (plus the changes already in the workspace) to resume from the first unfinished item — do NOT start over or re-explore what the Findings already cover. If it does NOT exist, you are starting fresh.
\`.olympian/\` is excluded from commits, so none of this reaches the PR.`;

// The structural fix for context bloat: keep file bodies OUT of the parent's context. The parent
// orchestrates from the plan + PROGRESS.md and delegates each unit of file work to a child that has
// its own fresh context window; the parent only ever sees the child's short summary.
export const DELEGATION_STRATEGY = `**You are the ORCHESTRATOR — delegate the file work, don't do it yourself.** Hand each concrete unit of work to a fresh subagent with its own context window: it reads and edits in ITS context and returns only a short summary, so file bodies never enter yours.

1. **Map the work once.** Unless you already know exactly where everything lives, spawn ONE read-only survey subagent and use its summary to split the work into small units — ideally one file (or one acceptance criterion / issue) per unit. Do not read source yourself to plan.
   delegate_task(goal="Locate the files and line ranges relevant to each item to be implemented/fixed", context="<the plan / issues>", toolsets=["file"], max_iterations=10)
2. **Delegate each unit.** For every item, spawn a subagent that does the actual reading and editing:
   delegate_task(
     goal="<the specific change to make>. Work test-first: add or extend the automated test that encodes the acceptance criterion and confirm it FAILS first, then implement until it passes — set up the standard runner for this stack if none exists (Vitest for Vite/TS, Jest for plain Node, pytest for Python), and never weaken, skip, or delete a test to go green. Run the project's static analysis on the files you touch and fix every error. Report the exact files and line ranges you changed plus the test result — do not paste file contents back.",
     context="<the slice of the plan/issue this unit covers and where it lives, from the survey>",
     toolsets=["file","terminal","search"],
     max_iterations=40,
   )
   Run units that touch DIFFERENT files in parallel; run units that share a file or depend on each other ONE at a time, feeding the earlier unit's summary into the next unit's context.
3. **Mark it done — the report is saved for you.** When a subagent returns, mark its todo item completed. Its full report is appended automatically to the Findings of \`.olympian/PROGRESS.md\`, so you do NOT need to copy it anywhere or re-open the file to verify — trust the report; the verification stage is the safety net.
4. **Reserve your own tools** for keeping the todo list current, small cross-cutting wiring that spans several summaries, and a final whole-repo static-analysis pass before finishing. A trivial single-file change you may make directly — but anything that needs you to read substantial code MUST be delegated.`;

export const STATIC_ANALYSIS_INSTRUCTIONS = `**After making changes, run the project's static analysis tooling to catch errors before committing:**
- **TypeScript / Node.js**: check \`package.json\` scripts for \`typecheck\`, \`lint\`, \`build\` — run whichever exist (e.g. \`npm run typecheck && npm run lint\`); if no script exists, try \`npx tsc --noEmit\`
- **Python**: run \`mypy\` and \`ruff check .\` (or \`pylint\`) if available; check \`pyproject.toml\` or \`setup.cfg\` for the configured tools
- **Go**: run \`go build ./...\` and \`go vet ./...\`
- **Rust**: run \`cargo check\` and \`cargo clippy\`
- **Java / Kotlin**: run \`./gradlew compileJava\` or \`mvn compile test-compile\`
- **Any other language**: check \`Makefile\`, \`justfile\`, or \`.github/workflows/\` to find the right lint/type-check/compile commands
Fix all errors and warnings before finishing — a clean static analysis pass is required.`;
