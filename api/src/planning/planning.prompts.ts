import { AUTONOMY_NOTICE } from '../agent/agent.prompts.js';
import { type PlanPromptContext } from './planning.model.js';

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

  parts.push(AUTONOMY_NOTICE);
  parts.push(PLAN_OUTPUT_CONTRACT);

  return parts.join('\n\n');
}
