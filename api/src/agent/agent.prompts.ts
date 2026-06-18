// Shared prompt fragments used across multiple agent work phases. Phase-specific
// prompt builders live in their own modules (planning, implement, revise, verify,
// summary, review); only cross-phase content belongs here.

// Counters the most common failure mode: the agent ends a turn by asking whether to
// continue. In headless --yolo mode there is no human to answer, so that strands the run.
export const AUTONOMY_NOTICE = `You are running fully autonomously — there is NO human watching and nobody can answer questions mid-run. Never end your turn by asking whether to continue, asking for confirmation, or noting that your response was "cut off". If there is more work to do, just keep going until it is genuinely complete. When you must make a judgement call, choose the most reasonable option, proceed, and record the assumption in your final summary — do not stop to ask.`;

export const STATIC_ANALYSIS_INSTRUCTIONS = `**After making changes, run the project's static analysis tooling to catch errors before committing:**
- **TypeScript / Node.js**: check \`package.json\` scripts for \`typecheck\`, \`lint\`, \`build\` — run whichever exist (e.g. \`npm run typecheck && npm run lint\`); if no script exists, try \`npx tsc --noEmit\`
- **Python**: run \`mypy\` and \`ruff check .\` (or \`pylint\`) if available; check \`pyproject.toml\` or \`setup.cfg\` for the configured tools
- **Go**: run \`go build ./...\` and \`go vet ./...\`
- **Rust**: run \`cargo check\` and \`cargo clippy\`
- **Java / Kotlin**: run \`./gradlew compileJava\` or \`mvn compile test-compile\`
- **Any other language**: check \`Makefile\`, \`justfile\`, or \`.github/workflows/\` to find the right lint/type-check/compile commands
Fix all errors and warnings before finishing — a clean static analysis pass is required.`;
