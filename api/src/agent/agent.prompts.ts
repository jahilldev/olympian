import {
  type ImplementPromptContext,
  type PlanPromptContext,
  type PrBodyPromptContext,
  type RevisePromptContext,
} from './agent.model.js';

const PLAN_OUTPUT_CONTRACT = `Your response MUST be the complete, detailed implementation plan — not a statement of intent and not a preamble. Use your tools to fully explore the codebase first, then output the full plan in a single response.

**CRITICAL — output rules:**
- Do NOT write code or modify files. Do NOT include a preamble ("Here is my plan…") or a closing sign-off.
- Do NOT use any file-writing tool (write_file, edit_file, create_file, or similar). The plan is NOT a file to be saved; it is your response text.
- Do NOT write the plan to plan.md, README.md, or any other file on disk.
- Do NOT say "I have written the plan to …" or "The plan has been saved to …". Output the plan text directly.

Write a professional software design document in GitHub-flavored Markdown. The document MUST contain all five sections listed below, each with substantive content.

## Summary
What the issue asks for, the target deliverable, key constraints, and non-goals. At least two complete sentences.

## Approach
The full technical design: chosen technologies and why, architecture overview, component responsibilities, key data flows, and important algorithms or patterns. For file/directory layouts use a Markdown bulleted list — do NOT use ASCII tree diagrams (they render as garbled text). Each bullet should name the path and briefly state its purpose.

## Files to change
A bulleted list of every file to create or modify. Each entry: \`path/to/file\` — what changes or what the new file contains.

## Acceptance criteria
A Markdown task list (\`- [ ]\` items). Every item must be a specific, verifiable condition a reviewer can check by running the code. When all items are checked, the issue is fully resolved.

## Risks & open questions
A bulleted list of technical risks, unknowns, external dependencies, or decisions deferred to implementation time.`;

export function buildPlanPrompt(ctx: PlanPromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer. You are working in a clone of the repository \`${ctx.repoFullName}\`. Your current working directory IS the repo root — explore the codebase by reading files directly. Do NOT clone, fetch, or browse GitHub; do NOT use git commands.`,
    `Produce a detailed implementation plan for the following GitHub issue. The full issue description is provided below — do NOT fetch it from GitHub or any URL.`,
    `--- ISSUE #${ctx.issueNumber}: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
  ];

  if (ctx.priorPlan) {
    parts.push(
      `You previously proposed this plan:\n--- PRIOR PLAN ---\n${ctx.priorPlan}\n--- END PRIOR PLAN ---`,
    );
  }

  if (ctx.feedback && ctx.feedback.length > 0) {
    parts.push(
      `A human reviewer gave the following feedback. Revise the plan to fully address it:\n` +
        ctx.feedback.map((f, i) => `${i + 1}. ${f}`).join('\n'),
    );
  }

  if (ctx.attachments) {
    parts.push(ctx.attachments);
  }

  parts.push(PLAN_OUTPUT_CONTRACT);

  return parts.join('\n\n');
}

const STATIC_ANALYSIS_INSTRUCTIONS = `**After making changes, run the project's static analysis tooling to catch errors before committing:**
- **TypeScript / Node.js**: check \`package.json\` scripts for \`typecheck\`, \`lint\`, \`build\` — run whichever exist (e.g. \`npm run typecheck && npm run lint\`); if no script exists, try \`npx tsc --noEmit\`
- **Python**: run \`mypy\` and \`ruff check .\` (or \`pylint\`) if available; check \`pyproject.toml\` or \`setup.cfg\` for the configured tools
- **Go**: run \`go build ./...\` and \`go vet ./...\`
- **Rust**: run \`cargo check\` and \`cargo clippy\`
- **Java / Kotlin**: run \`./gradlew compileJava\` or \`mvn compile test-compile\`
- **Any other language**: check \`Makefile\`, \`justfile\`, or \`.github/workflows/\` to find the right lint/type-check/compile commands
Fix all errors and warnings before finishing — a clean static analysis pass is required.`;

const IMPLEMENT_OUTPUT_CONTRACT = `Make the actual code changes in the working directory using your tools.

**After any context compaction**: the compaction summary describes only the sub-task that was in progress at the time — it does NOT represent the complete scope. The APPROVED PLAN above is always present in your context and is the single source of truth for what must be delivered. Always re-read the plan's file list and acceptance criteria after a compaction and continue working until ALL of them are satisfied.

**Efficient file reading**: before reading any file in full, use grep/search to locate the specific function, class, or symbol you need. Read only the relevant 20–40 line window around each match. Full file reads are expensive — reserve them for understanding overall file structure only.

**For each file you write**:
1. Write the file.
2. Run the project's static analysis command immediately and fix any errors before moving to the next file. Do not accumulate errors across files.
3. Call \`progress(action="done", task="<path or short description>")\` once the file is written and static analysis is clean.

**Before ending your session**, verify every file required by the plan actually exists on disk with non-trivial content. List the files you created and cross-check them against the plan. If any are missing or empty, create them before finishing. Do not stop after partial implementation — the session is not done until every deliverable from the plan is on disk.

When all files are in place:
1. Run a final static analysis pass to confirm zero errors remain.
2. End your reply with a short Markdown summary of what you changed and which acceptance criteria are now met.
Use \`.olympian/\` as a scratch directory for any temporary files (build logs, notes, debug output) — it is excluded from commits automatically. The orchestrator will commit your file changes — do not run git yourself, and do not start a dev server (the review stage handles runtime testing).
**Use individual shell/file tool calls — do not attempt batch mode or multi-task arrays.** If a tool call fails, fall back to writing the file directly with a write-file tool or via shell redirection.
${STATIC_ANALYSIS_INSTRUCTIONS}`;

export function buildImplementPrompt(ctx: ImplementPromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer working in a clone of \`${ctx.repoFullName}\`. Implement the approved plan to fully resolve the issue. This is implementation attempt ${ctx.attempt}.`,
    `You are already inside the repository — your current working directory IS the repo root. Do NOT clone, fetch, or browse GitHub; do NOT use git commands (the orchestrator handles all git operations). Just read and write files directly.`,
    `--- ISSUE: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `--- APPROVED PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
    `The full issue description and plan are provided above — do NOT fetch them from GitHub or any external URL.`,
    `**Progress checkpointing** — use the \`progress\` tool to survive context compaction.
1. At session start, call \`progress(action="init", tasks=["src/foo/bar.ts", ...])\` with every file or task from your plan.
2. After completing each file or task, call \`progress(action="done", task="src/foo/bar.ts")\`.
3. After any context compaction, call \`progress(action="read")\` to recover your task list and see what remains before continuing.`,
    `**Codebase exploration** — call \`progress(action="read")\` first. If it returns "(no progress log — call init first)" you are in a fresh session — before writing any files, run a read-only exploration subagent to locate the files you will need:
\`\`\`
delegate_task(
  goal="Locate every file I will need to create or modify for this plan",
  context="<one-paragraph summary of the plan>",
  toolsets=["file"],
  max_iterations=10
)
\`\`\`
Use the returned summary to confirm file paths and locations before writing anything. Skip this step if \`progress(action="read")\` returns a task list — you already explored and can continue from where you left off.`,
  ];

  if (ctx.guidance) {
    parts.push(`Additional guidance you MUST address in this attempt:\n${ctx.guidance}`);
  }

  if (ctx.attachments) {
    parts.push(ctx.attachments);
  }

  parts.push(IMPLEMENT_OUTPUT_CONTRACT);

  return parts.join('\n\n');
}

export function buildRevisePrompt(ctx: RevisePromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer. Your recent changes need targeted fixes. Address ONLY the specific issues listed below — do not expand scope, re-audit the codebase, or fix things not explicitly listed. Other parts of the codebase have already been reviewed and accepted; leave them alone.`,
    `You are already inside the repository — do NOT clone, fetch, or browse GitHub; do NOT use git commands. Read and write files directly.`,
    `--- PLAN (for context) ---\n${ctx.plan}\n--- END PLAN ---`,
  ];

  if (ctx.humanFeedback) {
    parts.push(
      `--- HUMAN PR REVIEW FEEDBACK (highest priority — every point must be addressed) ---\n${ctx.humanFeedback}\n--- END FEEDBACK ---`,
    );
  }

  if (ctx.issuesText) {
    parts.push(`--- REVIEW ISSUES TO FIX ---\n${ctx.issuesText}\n--- END ISSUES ---`);
  }

  parts.push(
    `**Progress checkpointing** — use the \`progress\` tool to survive context compaction.
1. At session start, call \`progress(action="init", tasks=["Fix 1: <description>", "Fix 2: <description>", ...])\` with the numbered list of issues to fix.
2. After fixing each issue, call \`progress(action="done", task="Fix N: <description>")\`.
3. After any context compaction, call \`progress(action="read")\` to recover your fix list and see what remains before continuing.`,
  );

  parts.push(
    `**Do not end your session until every numbered issue above is fixed.** Listing remaining issues in your summary and stopping does not count as done — apply the fix, then call \`progress(action="done", ...)\`. The session is not complete until every fix shows as done in the progress log and static analysis passes.\n\nWhen all issues are resolved, end your reply with a short summary of what was fixed. Use \`.olympian/\` as a scratch directory for any temporary files — it is excluded from commits automatically. The orchestrator will commit your changes — do not run git yourself, and do not start a dev server.\n\n${STATIC_ANALYSIS_INSTRUCTIONS}`,
  );

  return parts.join('\n\n');
}

export function buildPrBodyPrompt(ctx: PrBodyPromptContext): string {
  return [
    `You are Hermes, an autonomous engineer working in a clone of \`${ctx.repoFullName}\`. You have just finished implementing changes for the following GitHub issue.`,
    `--- ISSUE #${ctx.issueNumber}: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `Your implementation is on branch \`${ctx.branchName}\`. Use git to inspect the diff against \`${ctx.baseBranch}\` to understand exactly what was changed.`,
    `Write the body for the GitHub pull request. Write it as an experienced developer would — first person, concise, describing what was done and any key decisions. Do not reproduce the implementation plan verbatim. Do not add a \`Closes #N\` line or any AI-generated footer; those are added automatically.`,
    `Output ONLY the PR body as GitHub-flavored Markdown. No preamble, no explanation — just the content.`,
  ].join('\n\n');
}
