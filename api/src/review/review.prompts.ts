import { type ReviewPromptContext } from './review.model.js';

export function buildReviewPrompt(ctx: ReviewPromptContext): string {
  const parts: string[] = [
    `You are Hermes acting as a rigorous senior code reviewer for \`${ctx.repoFullName}\`. The working directory contains a branch with changes committed on top of \`${ctx.baseBranch}\`. Review the diff of this branch against \`${ctx.baseBranch}\` (use git to inspect it). Use \`.olympian/\` as a scratch directory for any temporary files such as diffs — it is excluded from commits automatically. **This is a read-only review: do NOT modify any source files and do NOT use the clarify tool. If you find a bug, record it in the issues array — do not fix it.**

Use checkpoint to track review progress so you can resume after context compaction without re-reviewing files:
- At the start: \`checkpoint(action="init", tasks=["Review <file1>", "Review <file2>", ...])\` — one entry per changed file or logical area.
- After each file: \`checkpoint(action="done", index=N, notes="summary of findings — e.g. 2 issues found, or clean")\`.
- After any context compaction: \`checkpoint(action="read")\` — use the \`summary.pending\` list to see exactly which files remain.
- The JSON verdict block below is the sole completion signal — do NOT use checkpoint to indicate the review is finished.`,
    `Judge whether the changes correctly and completely resolve the issue, satisfy the plan's acceptance criteria, and meet a professional bar for correctness, security, and tests.`,
    `--- ISSUE: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `--- APPROVED PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
  ];

  if (ctx.humanFeedback) {
    parts.push(
      `--- HUMAN PR REVIEW FEEDBACK (highest priority — verify every point is addressed) ---\n${ctx.humanFeedback}\n--- END FEEDBACK ---`,
    );
  }

  if (ctx.priorIssues && ctx.priorIssues.length > 0) {
    const formatted = ctx.priorIssues
      .map((issue, i) => {
        const loc = issue.file ? ` (${issue.file})` : '';
        return `${i + 1}. [${issue.severity}] ${issue.title}${loc}\n   ${issue.detail}`;
      })
      .join('\n');

    parts.push(
      `--- ISSUES FROM PRIOR REVIEW PASS (verify each is now resolved) ---\n${formatted}\n--- END PRIOR ISSUES ---\n\nFor each prior issue, explicitly state in your summary whether it is resolved. **If an issue is not fully resolved — including partial fixes — it MUST appear in your JSON "issues" array.** Mentioning it only in the summary is not sufficient; the issues array is the only signal the next revision receives. Then perform a full independent review of all changes to catch any additional problems not listed above.`,
    );
  }

  if (ctx.hasBrowser) {
    parts.push(
      `A Camofox browser is available for a smoke-test of the running application. **This is secondary to the code review — do not let it block your verdict.**

Steps (do them exactly once in this order, then move on):
1. Start the dev server bound to all interfaces so Camofox can reach it through Docker's port proxy. Determine the framework from package.json first, then use the appropriate command:
   - Vite: \`npm run dev -- --host 0.0.0.0 > /tmp/dev.log 2>&1 &\`
   - Next.js: \`npm run dev > /tmp/dev.log 2>&1 &\` (binds all interfaces by default)
   - Create React App: \`HOST=0.0.0.0 npm start > /tmp/dev.log 2>&1 &\`
   - Other: check for a \`--host\` flag or \`HOST\` env var, then fall back to \`npm run dev > /tmp/dev.log 2>&1 &\`
2. Wait a fixed 10 seconds: \`sleep 10\`.
3. Check once with curl: \`curl -sf http://localhost:<port> -o /dev/null && echo OK || echo FAILED\`. Do NOT retry — if it prints FAILED, note it in your assessment and continue.
4. If the server responded, use Camofox to open \`http://localhost:<port>\` and click through the key user flows from the acceptance criteria. Spend no more than a few interactions per flow.
5. Kill the server when done: \`kill %1\` (ignore errors).

**Ports forwarded to Camofox:** 3000, 3001, 4000, 4200, 5000, 5173, 5174, 8000, 8080, 8888. Navigate to \`http://localhost:<port>\` — do not use the container hostname or any internal IP.

If the server fails to start, skip the browser step and note it in your summary — your code-level verdict still stands.`,
    );
  }

  parts.push(
    `Files changed on this branch:\n${ctx.changedFiles.map((f) => `- ${f}`).join('\n') || '(none detected)'}`,
    `Output your verdict as the FIRST thing in your response — a \`\`\`json block before any other text:
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
Set "verdict" to "PASS" only if confidence >= ${ctx.threshold} and there are no high/critical issues. List every concrete problem in "issues"; use an empty array if there are none. You may include detailed reasoning after the JSON block.`,
  );

  if (ctx.parseRetry) {
    parts.push(
      `IMPORTANT: Your previous response did not contain a valid \`\`\`json block and could not be parsed. ` +
        `This time you MUST start your response with the JSON block above — do not write any preamble or narrative before it.`,
    );
  }

  return parts.join('\n\n');
}
