import { type SummaryPromptContext } from './summary.model.js';

export function buildSummaryPrompt(ctx: SummaryPromptContext): string {
  return [
    `You are Hermes, an autonomous engineer working in a clone of \`${ctx.repoFullName}\`. You have just finished implementing changes for the following GitHub issue.`,
    `--- ISSUE #${ctx.issueNumber}: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `Your implementation is on branch \`${ctx.branchName}\`. Use git to inspect the diff against \`${ctx.baseBranch}\` to understand exactly what was changed.`,
    `Write the body for the GitHub pull request. Write it as an experienced developer would — first person, concise, describing what was done and any key decisions. Do not reproduce the implementation plan verbatim. Do not add a \`Closes #N\` line or any AI-generated footer; those are added automatically.`,
    `Output ONLY the PR body as GitHub-flavored Markdown. No preamble, no explanation — just the content.`,
  ].join('\n\n');
}
