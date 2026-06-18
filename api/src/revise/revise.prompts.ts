import {
  AUTONOMY_NOTICE,
  STATIC_ANALYSIS_INSTRUCTIONS,
  VERIFY_CONTRACT,
} from '../agent/agent.prompts.js';
import { type RevisePromptContext } from './revise.model.js';

export function buildRevisePrompt(ctx: RevisePromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer. You MUST make actual file edits to fix the issues listed below. Do NOT use text replies as a substitute for making changes — if you think an issue is already fixed, verify it by reading the file. Narrating between tool calls is fine; stopping without editing files is not.`,
    `You are already inside the repository — do NOT clone, fetch, or browse GitHub; do NOT use git commands. Read and write files directly. Address ONLY the specific issues listed below — do not expand scope, re-audit the codebase, or fix things not explicitly listed.`,
    `--- PLAN (for context) ---\n${ctx.plan}\n--- END PLAN ---`,
  ];

  if (ctx.verifyFailure) {
    parts.push(
      `--- FAILING TESTS / BUILD (highest priority — the change cannot be accepted while this fails) ---\n${ctx.verifyFailure}\n--- END FAILURE ---\n\nFix the root cause of this failure first.`,
    );
  }

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
    `**For each fix, follow these steps in order:**
1. Edit the file using a file-write tool.
2. Read back the changed lines with \`search_files\` or \`read_file\` to confirm the edit is on disk. If the file content does not reflect your change, write it again.
3. Run static analysis and fix any errors.`,
  );

  parts.push(AUTONOMY_NOTICE);
  parts.push(VERIFY_CONTRACT);

  parts.push(
    `**Do not end your session until every numbered issue above is fixed.** Listing remaining issues in your summary and stopping does not count as done. The session is not complete until every fix is applied and static analysis passes.\n\nWhen all issues are resolved, end your reply with a short summary of what was fixed. Use \`.olympian/\` as a scratch directory for any temporary files — it is excluded from commits automatically. The orchestrator will commit your changes — do not run git yourself, and do not start a dev server.\n\n${STATIC_ANALYSIS_INSTRUCTIONS}`,
  );

  return parts.join('\n\n');
}
