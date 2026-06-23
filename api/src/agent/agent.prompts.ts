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

export const READ_DISCIPLINE = `**Read narrowly — your context window is a scarce resource, and filling it is the #1 cause of failed runs here.** Reading whole files triggers a context compaction that silently discards those file contents, forcing you to re-read them — a loop that wastes the whole budget. Avoid it:
- ALWAYS \`search_files\` for the exact symbol, function, or text you need, then \`read_file\` ONLY that region with \`offset\`/\`limit\` (a ~20-40 line window). Never read a file in full just to orient yourself.
- NEVER re-read a file or range you have already read this session. If you need to remember something, write it to your notes (below) the first time — do not re-open the file.
- Prefer \`patch\` (small, targeted edits) over \`write_file\` (whole-file rewrites): patches keep both your context and the diff small. Use \`write_file\` only for genuinely new files.
- Work ONE file at a time — read its window, edit, verify, record progress, move on. Do not pre-load many files at once.`;

export const WORKING_MEMORY_CONTRACT = `**Keep durable working notes in \`.olympian/PROGRESS.md\`.** A context compaction keeps only a short summary — it throws away file contents and your detailed findings. So persist what matters to disk, where compaction cannot erase it:
- FIRST, create \`.olympian/PROGRESS.md\` with a checklist (one \`- [ ]\` item per acceptance criterion / issue / failing test) and an empty "## Findings" section.
- As you work, append concise findings: which file and line range implements what, key signatures, decisions made, and what each remaining item still needs. Record PATHS and line ranges — never paste file contents.
- Tick an item (\`- [x]\`) only once its change is on disk and static analysis passes.
- After ANY context compaction, re-read \`.olympian/PROGRESS.md\` FIRST to re-orient, then resume from the first unchecked item. Do NOT re-explore the codebase or re-read source you have already covered — your notes are the memory, not the transcript.
\`.olympian/\` is excluded from commits, so these notes never reach the PR.`;

export const STATIC_ANALYSIS_INSTRUCTIONS = `**After making changes, run the project's static analysis tooling to catch errors before committing:**
- **TypeScript / Node.js**: check \`package.json\` scripts for \`typecheck\`, \`lint\`, \`build\` — run whichever exist (e.g. \`npm run typecheck && npm run lint\`); if no script exists, try \`npx tsc --noEmit\`
- **Python**: run \`mypy\` and \`ruff check .\` (or \`pylint\`) if available; check \`pyproject.toml\` or \`setup.cfg\` for the configured tools
- **Go**: run \`go build ./...\` and \`go vet ./...\`
- **Rust**: run \`cargo check\` and \`cargo clippy\`
- **Java / Kotlin**: run \`./gradlew compileJava\` or \`mvn compile test-compile\`
- **Any other language**: check \`Makefile\`, \`justfile\`, or \`.github/workflows/\` to find the right lint/type-check/compile commands
Fix all errors and warnings before finishing — a clean static analysis pass is required.`;
