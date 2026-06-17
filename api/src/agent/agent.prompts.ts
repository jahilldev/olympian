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

**Efficient file reading**: before reading any file in full, use \`search_files\` to locate the specific function, class, or symbol you need. Read only the relevant 20–40 line window around each match. Full file reads are expensive — reserve them for understanding overall file structure only.

**For each task in your checkpoint list**:
1. Write the file.
2. Run static analysis and fix all errors before continuing.
3. Call \`checkpoint(action="done", index=N, notes="brief description of what was done or any caveats")\`. **Do not start the next task until this call succeeds.** This is a hard gate, not optional bookkeeping — it is the only signal that a task is complete.

If a task becomes irrelevant or was already handled, call \`checkpoint(action="skip", index=N, notes="reason")\` rather than leaving it as \`[ ]\`.

If context is ever compacted and you lose your task list, call \`checkpoint(action="read")\` — the response includes both the file content and a structured \`summary\` with \`pending\`, \`completed\`, and \`skipped\` index lists so you can see exactly where you are.

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
  ];

  if (ctx.guidance) {
    parts.push(
      `--- MANDATORY CORRECTIONS (read in full before doing anything else) ---\n${ctx.guidance}\n--- END CORRECTIONS ---\n\nThis is a retry — the workspace already contains code from the previous attempt. Do NOT recreate files that already exist and do NOT re-implement work that is already done. Survey the workspace first, then address ONLY the specific items listed in the corrections above.`,
    );
  }

  parts.push(
    `**Codebase exploration** — before writing any files, run a read-only exploration subagent to survey the relevant parts of the codebase:
\`\`\`
delegate_task(
  goal="Locate every file I will need to create or modify for this plan",
  context="<one-paragraph summary of the plan>",
  toolsets=["file"],
  max_iterations=10
)
\`\`\`
Use the returned summary to confirm file paths and current state before writing anything. Once you understand exactly what needs to be done, call \`checkpoint(action="init", tasks=[...], force=True)\` with your definitive task list. \`force=True\` is required here because a prior attempt may have left completed tasks in the file.`,
  );

  if (ctx.attachments) {
    parts.push(ctx.attachments);
  }

  parts.push(IMPLEMENT_OUTPUT_CONTRACT);

  return parts.join('\n\n');
}

export function buildRevisePrompt(ctx: RevisePromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer. You MUST make actual file edits to fix the issues listed below. Do NOT use text replies as a substitute for making changes — if you think an issue is already fixed, verify it by reading the file and confirm with a checkpoint done call. Narrating between tool calls is fine; stopping without editing files is not.`,
    `You are already inside the repository — do NOT clone, fetch, or browse GitHub; do NOT use git commands. Read and write files directly. Address ONLY the specific issues listed below — do not expand scope, re-audit the codebase, or fix things not explicitly listed.`,
    `--- PLAN (for context) ---\n${ctx.plan}\n--- END PLAN ---`,
  ];

  if (ctx.humanFeedback) {
    parts.push(
      `--- HUMAN PR REVIEW FEEDBACK (highest priority — every point must be addressed) ---\n${ctx.humanFeedback}\n--- END FEEDBACK ---`,
    );
  }

  const issueSections: string[] = [];

  if (ctx.latestIssuesText) {
    issueSections.push(`Issues from the latest review:\n${ctx.latestIssuesText}`);
  }

  if (ctx.priorIssuesText) {
    issueSections.push(
      `Issues from the prior review pass (the reviewer may have overlooked some when updating their list — verify whether each is still present before skipping it):\n${ctx.priorIssuesText}`,
    );
  }

  if (issueSections.length > 0) {
    parts.push(`--- REVIEW ISSUES TO FIX ---\n${issueSections.join('\n\n')}\n--- END ISSUES ---`);
  }

  parts.push(
    `**Your first tool call must be** \`checkpoint(action="init", tasks=["Fix 1: <description>", "Fix 2: <description>", ...], force=True)\` with a numbered entry for every specific fix you must make. \`force=True\` is required — a prior revision pass may have left completed tasks in the file.

**For each fix, follow these steps in order — skipping any step means the fix is not done:**
1. Edit the file using a file-write tool.
2. Read back the changed lines with \`search_files\` or \`read_file\` to confirm the edit is on disk. If the file content does not reflect your change, write it again.
3. Run static analysis and fix any errors.
4. Call \`checkpoint(action="done", index=N, notes="what was changed and why")\` — **do not move to the next fix until this call succeeds**.

If a fix is superseded or no longer applicable, call \`checkpoint(action="skip", index=N, notes="reason")\` — never leave a fix as \`[ ]\`.

If context is compacted, call \`checkpoint(action="read")\` — the response includes a structured \`summary\` with \`pending\`, \`completed\`, and \`skipped\` index lists.`,
  );

  parts.push(
    `**Do not end your session until every numbered issue above is fixed.** Listing remaining issues in your summary and stopping does not count as done. The session is not complete until every fix is applied, marked done in the checkpoint, and static analysis passes.\n\nWhen all issues are resolved, end your reply with a short summary of what was fixed. Use \`.olympian/\` as a scratch directory for any temporary files — it is excluded from commits automatically. The orchestrator will commit your changes — do not run git yourself, and do not start a dev server.\n\n${STATIC_ANALYSIS_INSTRUCTIONS}`,
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
