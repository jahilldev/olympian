import {
  AUTONOMY_NOTICE,
  DELEGATION_STRATEGY,
  READ_DISCIPLINE,
  STATIC_ANALYSIS_INSTRUCTIONS,
  VERIFY_CONTRACT,
  WORKING_MEMORY_CONTRACT,
  progressBlock,
} from '../agent/agent.prompts.js';
import { type RevisePromptContext } from './revise.model.js';

export function buildRevisePrompt(ctx: RevisePromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer. You MUST make actual file edits to fix the issues listed below. Do NOT use text replies as a substitute for making changes — if you think an issue is already fixed, verify it by reading the file. Narrating between tool calls is fine; stopping without editing files is not.`,
    `You are already inside the repository — do NOT clone, fetch, or browse GitHub; do NOT use git commands. Read and write files directly. Address ONLY the specific issues listed below — do not expand scope, re-audit the codebase, or fix things not explicitly listed.`,
    `--- PLAN (for context) ---\n${ctx.plan}\n--- END PLAN ---`,
  ];

  if (ctx.incompleteWork) {
    parts.push(
      `--- UNFINISHED WORK FROM YOUR PREVIOUS PASS (highest priority — you stopped before completing these) ---\n${ctx.incompleteWork}\n--- END UNFINISHED WORK ---\n\nThe workspace already contains your previous changes — do NOT redo completed work. Continue from where you left off and finish exactly these remaining items.`,
    );
  }

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

  if (ctx.attachments) {
    parts.push(ctx.attachments);
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

  parts.push(READ_DISCIPLINE);
  parts.push(WORKING_MEMORY_CONTRACT);
  if (ctx.progress) {
    parts.push(progressBlock(ctx.progress));
  }
  parts.push(DELEGATION_STRATEGY);
  parts.push(AUTONOMY_NOTICE);
  parts.push(VERIFY_CONTRACT);

  parts.push(
    `**Finishing:** the session is not done until every numbered issue above is fixed and static analysis passes — listing remaining issues and stopping does not count. Then end with a short summary of what was fixed. Do not start a dev server (the review stage handles runtime testing).\n\n${STATIC_ANALYSIS_INSTRUCTIONS}`,
  );

  return parts.join('\n\n');
}
