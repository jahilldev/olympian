import {
  type ImplementPromptContext,
  type PlanPromptContext,
  type PrBodyPromptContext,
  type RevisePromptContext,
  type TestPromptContext,
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
  const parts: string[] = [
    `You are Hermes, an autonomous engineer. Your recent changes need fixes. Edit the files in the working directory to address every issue below; do not regress already-correct work.`,
    `--- PLAN (for context) ---\n${ctx.plan}\n--- END PLAN ---`,
  ];
  if (ctx.humanFeedback) {
    parts.push(`--- HUMAN PR REVIEW FEEDBACK (highest priority — every point must be addressed) ---\n${ctx.humanFeedback}\n--- END FEEDBACK ---`);
  }
  if (ctx.testOutput) {
    parts.push(`--- FAILING TEST OUTPUT ---\n${ctx.testOutput}\n--- END TEST OUTPUT ---`);
  }
  if (ctx.issuesText) {
    parts.push(`--- REVIEW ISSUES TO FIX ---\n${ctx.issuesText}\n--- END ISSUES ---`);
  }
  parts.push(`When finished, end your reply with a short summary of the fixes. The orchestrator will commit your changes — do not run git yourself.`);
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

export function buildTestPrompt(ctx: TestPromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer working in a clone of \`${ctx.repoFullName}\`. Your task is to ensure the test suite passes for the changes made to resolve: **${ctx.issueTitle}**.`,
    `--- APPROVED PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
    `Instructions:
1. Discover the test suite by inspecting the project structure (look for \`package.json\` test scripts, \`pytest.ini\`, \`jest.config.*\`, \`vitest.config.*\`, \`go.mod\`, \`Makefile\`, etc.).
2. Run the tests and capture the full output.
3. **Try to run the application itself** — start the dev server, CLI, or process and verify it launches without errors. For web/browser applications, open the running app in the browser and exercise the key user flows from the acceptance criteria. For CLI tools, invoke the main commands and check the output.
4. Report the results. Do NOT modify any source files — if tests fail or the application errors, document what went wrong and stop. Fixes are handled in a separate step.`,
  ];
  if (ctx.hasBrowser) {
    parts.push(
      `A Camofox browser is available for step 5. Use it to open the running application and manually verify the acceptance criteria — click through real user flows, not just check that the page loads.`,
    );
  }
  if (ctx.priorOutput) {
    parts.push(
      `The previous test run ended with this output — use it as your starting point:\n\`\`\`\n${ctx.priorOutput.slice(0, 4000)}\n\`\`\``,
    );
  }
  parts.push(
    `When done, write a brief summary of what ran, what passed, and what failed or errored (if anything). Use \`.olympian/\` as a scratch directory for any temporary files (diffs, logs, etc.) — it is excluded from commits automatically. Do not run git yourself.`,
  );
  return parts.join('\n\n');
}
