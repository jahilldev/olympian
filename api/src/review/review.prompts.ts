import { AUTONOMY_NOTICE } from '../agent/agent.prompts.js';
import { type ReviewPromptContext } from './review.model.js';

export function buildReviewPrompt(ctx: ReviewPromptContext): string {
  const parts: string[] = [
    `You are Hermes acting as a rigorous senior code reviewer for \`${ctx.repoFullName}\`. The working directory contains a branch with changes committed on top of \`${ctx.baseBranch}\`. Review the diff of this branch against \`${ctx.baseBranch}\` (use git to inspect it). Use \`.olympian/\` as a scratch directory for any temporary files such as diffs — it is excluded from commits automatically. **This is a read-only review: do NOT modify any source files and do NOT use the clarify tool. If you find a bug, record it in the issues array — do not fix it.**`,
    `Judge whether the changes correctly and completely resolve the issue, satisfy the plan's acceptance criteria, and meet a professional bar for correctness, security, and tests.`,
    `**Read efficiently, but never review less.** Inspect the FULL diff against \`${ctx.baseBranch}\` — every changed file and every hunk. When you need surrounding context (a changed function's callers, a type or constant it relies on, related logic, the tests that cover it), use \`search_files\` to read the specific 20-40 line window instead of loading whole files. This is purely about HOW you read: a lean context won't get compressed mid-review, which is exactly when defects slip through. It must never narrow WHAT you review — follow the diff outward wherever a change could introduce a bug (broken callers, unhandled edge cases, security or data-loss risks, missing or weak tests), and do a complete independent pass even on hunks that look fine. If understanding a change demands reading more, read more.`,
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

  // The repo's tests/build already ran and passed in the dedicated VERIFY stage
  // before this review (a failure would have routed to REVISE, not here).
  parts.push(
    `The project's automated checks (tests/build) have already passed in a separate VERIFY stage — a green result is therefore a given, not evidence of quality, and the implementer wrote its own tests. **Scrutinise the tests themselves:** confirm an automated test exists for each acceptance criterion, that each genuinely exercises the new behaviour (it would fail without the implementation — watch for trivial, tautological, or assertion-free tests), and that no existing test was weakened, skipped, or deleted to reach green. Treat a missing or gamed test as a tests-dimension failure. Then focus on correctness, security, and full plan coverage.`,
  );

  if (ctx.outOfPlanFiles && ctx.outOfPlanFiles.length > 0) {
    parts.push(
      `--- SCOPE CHECK ---\nThese files were changed but aren't in the approved plan's "Files to change". Out-of-plan changes are frequently legitimate: a fix the build/tests required, a shared type/config, or repairing pre-existing breakage in another package/workspace. The VERIFY stage has already PASSED, so any change the green build depends on is in scope by definition — do NOT ask for it to be reverted. Only raise an issue if a change is clearly unrelated to the task, unnecessary for a passing build, AND risky (a genuine regression or accidental edit). A pure "this is beyond the plan" observation is at most "low" severity — NEVER high/critical — and on its own must not set "dimensions.planCoverage" to false. Files:\n${ctx.outOfPlanFiles.map((f) => `- ${f}`).join('\n')}\n--- END SCOPE CHECK ---`,
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

  parts.push(AUTONOMY_NOTICE);

  parts.push(
    `Files changed on this branch:\n${ctx.changedFiles.map((f) => `- ${f}`).join('\n') || '(none detected)'}`,
    `Output your verdict as the FIRST thing in your response — a \`\`\`json block before any other text:
\`\`\`json
{
  "confidence": <integer 0-100, advisory only — your subjective confidence>,
  "verdict": "PASS" | "FAIL",
  "dimensions": {
    "correctness": <true|false: the change is logically correct and resolves the issue>,
    "tests": <true|false: automated tests meaningfully encode each acceptance criterion — they exercise the new behaviour and would fail without it — and no existing test was weakened, skipped, or deleted>,
    "planCoverage": <true|false: every acceptance criterion in the plan is met. Necessary supporting changes (build/test fixes, shared config, repairing other packages the verify gate needs) are fine — only set false for missing criteria or material, unjustified, unrelated divergence>,
    "security": <true|false: no injection, secret-leak, auth, or unsafe-input problems introduced>
  },
  "summary": "<one-paragraph assessment>",
  "issues": [
    { "severity": "low|medium|high|critical", "title": "<short>", "detail": "<what's wrong and how to fix>", "file": "<path, optional>" }
  ]
}
\`\`\`
**The rubric is the gate, not the confidence number.** Set "verdict" to "PASS" ONLY when ALL FOUR dimensions are true AND there are no high/critical issues. Mark a dimension false the moment you are not confident it fully holds — err toward false. List every concrete problem in "issues" (empty array if none). You may include detailed reasoning after the JSON block.`,
  );

  if (ctx.parseRetry) {
    parts.push(
      `IMPORTANT — RETRY: your previous response could not be parsed against the required schema, so this review is being re-run. The verdict was discarded; none of that prior analysis was recorded. Conform EXACTLY this time:\n` +
        `- Start the response with a single \`\`\`json fenced block — no preamble, narrative, or prose before it.\n` +
        `- \`verdict\` MUST be the string "PASS" or "FAIL" (uppercase) — NOT a boolean (\`true\`/\`false\`), number, or any other word.\n` +
        `- \`confidence\` MUST be present, as an integer 0-100.\n` +
        `- \`dimensions\` MUST contain all four boolean keys: \`correctness\`, \`tests\`, \`planCoverage\`, \`security\`.\n` +
        `- MOST IMPORTANT — \`issues\`: every concrete problem MUST be a structured object in the \`issues\` array with the exact \`{severity,title,detail,file?}\` shape. This array is the ONLY thing passed to the agent that fixes the code — any finding left out, written as prose, or placed under a stray key (\`rationale\`, \`findings\`, \`explanation\`, …) is INVISIBLE to the fix stage and WILL NOT be fixed. Each \`detail\` must say both what is wrong and how to fix it. Put a FAIL's full reasoning here, not after the block.`,
    );
  }

  return parts.join('\n\n');
}
