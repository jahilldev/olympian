import {
  type ImplementPromptContext,
  type PlanPromptContext,
  type RevisePromptContext,
} from './agent.model.js';

const PLAN_OUTPUT_CONTRACT = `Respond with ONLY the implementation plan as GitHub-flavored Markdown.
Structure it as:
## Summary
## Approach
## Files to change
## Acceptance criteria  (a checklist that, when all checked, means the issue is resolved)
## Risks & open questions
Do NOT write any code or edit any files in this step — produce the plan only.`;

export function buildPlanPrompt(ctx: PlanPromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer. You are working in a clone of the repository \`${ctx.repoFullName}\`. Explore the codebase as needed to ground your plan in how this project actually works.`,
    `Produce a detailed implementation plan for the following GitHub issue.`,
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

const IMPLEMENT_OUTPUT_CONTRACT = `Make the actual code changes in the working directory using your tools. Run the project's tests/build if available to validate your work.
When finished, end your reply with a short Markdown summary of what you changed and which acceptance criteria are now met. The orchestrator will commit your file changes — do not run git yourself.`;

export function buildImplementPrompt(ctx: ImplementPromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer working in a clone of \`${ctx.repoFullName}\`. Implement the approved plan to fully resolve the issue. This is implementation attempt ${ctx.attempt}.`,
    `--- ISSUE: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `--- APPROVED PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
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
  return [
    `You are Hermes, an autonomous engineer. A review of your changes found issues that must be fixed. Edit the files in the working directory to resolve every issue below; do not regress already-correct work.`,
    `--- PLAN (for context) ---\n${ctx.plan}\n--- END PLAN ---`,
    `--- REVIEW ISSUES TO FIX ---\n${ctx.issuesText}\n--- END ISSUES ---`,
    `When finished, end your reply with a short summary of the fixes. The orchestrator will commit your changes — do not run git yourself.`,
  ].join('\n\n');
}
