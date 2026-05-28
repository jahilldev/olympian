import { type ReviewPromptContext } from './review.model.js';

export function buildReviewPrompt(ctx: ReviewPromptContext): string {
  return [
    `You are Hermes acting as a rigorous senior code reviewer for \`${ctx.repoFullName}\`. The working directory contains a branch with changes committed on top of \`${ctx.baseBranch}\`. Review the diff of this branch against \`${ctx.baseBranch}\` (use git to inspect it).`,
    `Judge whether the changes correctly and completely resolve the issue, satisfy the plan's acceptance criteria, and meet a professional bar for correctness, security, and tests.`,
    `--- ISSUE: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `--- APPROVED PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
    `Files changed on this branch:\n${ctx.changedFiles.map((f) => `- ${f}`).join('\n') || '(none detected)'}`,
    `Respond with ONLY a JSON object inside a \`\`\`json code block, matching exactly:
\`\`\`json
{
  "confidence": <integer 0-100, your confidence the change is correct and complete>,
  "verdict": "PASS" | "FAIL",
  "summary": "<one-paragraph assessment>",
  "issues": [
    { "severity": "low|medium|high|critical", "title": "<short>", "detail": "<what's wrong and how to fix>", "file": "<path, optional>" }
  ]
}
\`\`\`
Set "verdict" to "PASS" only if confidence >= ${ctx.threshold} and there are no high/critical issues. List every concrete problem in "issues"; use an empty array if there are none.`,
  ].join('\n\n');
}
