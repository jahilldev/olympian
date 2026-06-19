import {
  AUTONOMY_NOTICE,
  STATIC_ANALYSIS_INSTRUCTIONS,
  VERIFY_CONTRACT,
} from '../agent/agent.prompts.js';
import { type ImplementPromptContext } from './implement.model.js';

const IMPLEMENT_OUTPUT_CONTRACT = `Make the actual code changes in the working directory using your tools.

**After any context compaction**: the compaction summary describes only the sub-task that was in progress at the time — it does NOT represent the complete scope. The APPROVED PLAN above is always present in your context and is the single source of truth for what must be delivered. Always re-read the plan's file list and acceptance criteria after a compaction and continue working until ALL of them are satisfied.

**Efficient file reading**: before reading any file in full, use \`search_files\` to locate the specific function, class, or symbol you need. Read only the relevant 20-40 line window around each match. Full file reads are expensive — reserve them for understanding overall file structure only.

**For each task**:
1. Write the file.
2. Run static analysis and fix all errors before continuing.
3. Mark the task done in your todo list.

**Before ending your session**, verify every file required by the plan actually exists on disk with non-trivial content. List the files you created and cross-check them against the plan. If any are missing or empty, create them before finishing. Do not stop after partial implementation — the session is not done until every deliverable from the plan is on disk.

When all files are in place:
1. Run the acceptance-criteria tests and a final static analysis pass; confirm all tests pass and zero errors remain.
2. End your reply with a short Markdown summary of what you changed and which acceptance criteria now pass as tests.
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
Use the returned summary to confirm file paths and current state before writing anything.`,
  );

  parts.push(
    `**Work test-first.** For EACH acceptance criterion in the plan, write an automated test that encodes it BEFORE writing the implementation:
- If the repo already has a test framework, use it and mirror neighbouring test files.
- If it has NONE, set up the standard lightweight runner for this stack as part of the task (e.g. Vitest for a Vite/TypeScript project, Jest for plain Node, pytest for Python; Go and Rust have built-in test runners) and add a \`test\` script to the manifest so the verification step can run it.
Run the tests and confirm they FAIL for the right reason — the behaviour doesn't exist yet; a test that passes before you've implemented anything isn't testing the right thing, so fix it. Only then write the implementation, iterating until every test passes. Commit the tests (and any test config) alongside the implementation. NEVER weaken, skip, or delete a test to reach a green result — fix the code instead. Only skip tests entirely if the change genuinely has nothing to assert (e.g. docs or static assets) — and say so in your summary.`,
  );

  if (ctx.attachments) {
    parts.push(ctx.attachments);
  }

  parts.push(AUTONOMY_NOTICE);
  parts.push(VERIFY_CONTRACT);
  parts.push(IMPLEMENT_OUTPUT_CONTRACT);

  return parts.join('\n\n');
}
