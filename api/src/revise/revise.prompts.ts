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
  // Injected documents stay wrapped in `--- NAME --- … ---` fences so their own Markdown
  // headings never read as one of the prompt's own sections.
  const context: string[] = [`--- PLAN (for context) ---\n${ctx.plan}\n--- END PLAN ---`];

  if (ctx.incompleteWork) {
    context.push(
      `--- UNFINISHED WORK FROM YOUR PREVIOUS PASS (highest priority — you stopped before completing these) ---\n${ctx.incompleteWork}\n--- END UNFINISHED WORK ---\n\nThe workspace already contains your previous changes — do NOT redo completed work. Continue from where you left off and finish exactly these remaining items.`,
    );
  }

  if (ctx.verifyFailure) {
    context.push(
      `--- FAILING TESTS / BUILD (highest priority — the change cannot be accepted while this fails) ---\n${ctx.verifyFailure}\n--- END FAILURE ---\n\nFix the root cause of this failure first.`,
    );
  }

  if (ctx.humanFeedback) {
    context.push(
      `--- HUMAN PR REVIEW FEEDBACK (highest priority — every point must be addressed) ---\n${ctx.humanFeedback}\n--- END FEEDBACK ---`,
    );
  }

  if (ctx.attachments) {
    context.push(ctx.attachments);
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
    context.push(`--- REVIEW ISSUES TO FIX ---\n${issueSections.join('\n\n')}\n--- END ISSUES ---`);
  }

  if (ctx.progress) {
    context.push(progressBlock(ctx.progress));
  }

  const parts: string[] = [
    `# Role

You are Hermes, an autonomous engineer acting as the ORCHESTRATOR. The review issues listed below MUST be fully fixed in the code — do NOT use text replies as a substitute for real changes, and do NOT mark an issue fixed without confirming it. You delegate the edits to sub-agents (see Delegation); if you believe an issue is already fixed, confirm it by delegating a read-only check rather than assuming.

You are already inside the repository — do NOT clone, fetch, or browse GitHub, and do NOT use git commands. Address ONLY the specific issues listed below — do not expand scope, re-audit the codebase, or fix things not explicitly listed.`,
    `# Context\n\n${context.join('\n\n')}`,
    AUTONOMY_NOTICE,
    WORKING_MEMORY_CONTRACT,
    DELEGATION_STRATEGY,
    READ_DISCIPLINE,
    VERIFY_CONTRACT,
    `# Finishing

The session is not done until every numbered issue above is fixed and static analysis passes — listing remaining issues and stopping does not count. Then end with a short summary of what was fixed. Do not start a dev server (the review stage handles runtime testing).`,
    STATIC_ANALYSIS_INSTRUCTIONS,
  ];

  return parts.join('\n\n');
}
