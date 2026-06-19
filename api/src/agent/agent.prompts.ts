// Shared prompt fragments used across multiple agent work phases. Phase-specific
// prompt builders live in their own modules (planning, implement, revise, verify,
// summary, review); only cross-phase content belongs here.

// Counters the most common failure mode: the agent ends a turn by asking whether to
// continue. In headless --yolo mode there is no human to answer, so that strands the run.
export const AUTONOMY_NOTICE = `You are running fully autonomously — there is NO human watching and nobody can answer questions mid-run. Never end your turn by asking whether to continue, asking for confirmation, or noting that your response was "cut off". If there is more work to do, just keep going until it is genuinely complete. When you must make a judgement call, choose the most reasonable option, proceed, and record the assumption in your final summary — do not stop to ask.`;

// Your work is graded by a CLEAN, isolated build/test run from committed files only — not
// your live working directory. This is what catches "works on my machine": dependencies
// installed ad-hoc but never saved won't exist in the clean run.
export const VERIFY_CONTRACT = `**How your work is verified:** after you finish, the orchestrator runs the project's build/tests in a FRESH container from your COMMITTED files only — a clean install (e.g. \`npm ci\`, which installs strictly from the lockfile and ignores anything already in \`node_modules\`). Therefore:
- Any dependency you add MUST be saved to the manifest AND the lockfile and committed (e.g. \`npm install --save\`/\`--save-dev\`, which updates \`package.json\` and \`package-lock.json\`). Do NOT rely on packages you installed ad-hoc — they will not exist in the clean run.
- Do NOT delete the lockfile; keep it in sync with the manifest. Keep dependency versions consistent across workspaces.
- Before finishing, make sure a clean install of your committed manifests would build — don't trust a \`node_modules\` you mutated by hand.
- The check covers the WHOLE repo. If it fails in code outside this issue's scope — a pre-existing breakage in another package/workspace, or shared config — make the minimal fix needed to get a green result. That is expected and in-scope, not scope creep. Note what you changed outside the issue's area, and why, in your summary so the reviewer has context.`;

export const STATIC_ANALYSIS_INSTRUCTIONS = `**After making changes, run the project's static analysis tooling to catch errors before committing:**
- **TypeScript / Node.js**: check \`package.json\` scripts for \`typecheck\`, \`lint\`, \`build\` — run whichever exist (e.g. \`npm run typecheck && npm run lint\`); if no script exists, try \`npx tsc --noEmit\`
- **Python**: run \`mypy\` and \`ruff check .\` (or \`pylint\`) if available; check \`pyproject.toml\` or \`setup.cfg\` for the configured tools
- **Go**: run \`go build ./...\` and \`go vet ./...\`
- **Rust**: run \`cargo check\` and \`cargo clippy\`
- **Java / Kotlin**: run \`./gradlew compileJava\` or \`mvn compile test-compile\`
- **Any other language**: check \`Makefile\`, \`justfile\`, or \`.github/workflows/\` to find the right lint/type-check/compile commands
Fix all errors and warnings before finishing — a clean static analysis pass is required.`;
