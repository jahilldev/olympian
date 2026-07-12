import { AUTONOMY_NOTICE } from '../agent/agent.prompts.js';
import { type ReviewPromptContext } from './review.model.js';

const TESTS_CONTRACT = `# Tests

The project's automated checks (tests/build) have already passed in a separate VERIFY stage — a green result is therefore a given, not evidence of quality, and the implementer wrote its own tests. **Scrutinise the tests themselves:** confirm an automated test exists for each acceptance criterion, that each genuinely exercises the new behaviour (it would fail without the implementation — watch for trivial, tautological, or assertion-free tests), and that no existing test was weakened, skipped, or deleted to reach green. Treat a missing or gamed test as a tests-dimension failure. Then focus on correctness, security, and full coverage of the acceptance criteria.`;

const BROWSER_CONTRACT = `# Browser smoke-test (optional)

A Camofox browser is available for a smoke-test of the running application. **This is secondary to the code review — do not let it block your verdict.**

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

If the server fails to start, skip the browser step and note it in your summary — your code-level verdict still stands.`;

const VERDICT_CONTRACT = `# Output — verdict (required)

Your response MUST contain exactly ONE \`\`\`json fenced block — the verdict. It is the ONLY thing read: do NOT write it to a file (\`review.json\` or similar; a file is never read) and do NOT replace it with a prose summary. Reasoning before the block is fine, but there must be no second \`\`\`json block anywhere in your response.

The block must be STRICT, VALID JSON — real values only. Do NOT reproduce the notation from the field reference below: no \`<...>\` angle brackets, no \`"PASS" | "FAIL"\` alternatives, no \`//\` comments, no trailing commas. If you cannot emit valid JSON, the entire review is discarded and re-run.

Field reference (semantics — do not copy this notation into your output):
- \`confidence\`: integer 0-100 — your subjective confidence. Advisory only; NOT the gate.
- \`verdict\`: the string "PASS" or "FAIL", uppercase. Never a boolean, number, or lowercase.
- \`dimensions\`: four booleans, each \`true\` only if it fully holds —
  - \`correctness\`: the change is logically correct and resolves the issue.
  - \`tests\`: automated tests meaningfully encode each acceptance criterion (they exercise the new behaviour and would fail without it) and no existing test was weakened, skipped, or deleted.
  - \`criteria\`: every acceptance criterion in the plan is met. Necessary supporting changes (build/test fixes, shared config, repairing other packages the verify gate needs) are fine — only \`false\` for missing criteria or material, unjustified, unrelated divergence.
  - \`security\`: no injection, secret-leak, auth, or unsafe-input problems introduced.
- \`summary\`: one-paragraph assessment (string).
- \`issues\`: array of \`{ "severity", "title", "detail", "file" }\` objects — \`severity\` is one of "low", "medium", "high", "critical"; \`file\` is optional. EVERY concrete problem goes here — this array is the ONLY thing passed to the agent that fixes the code. A finding written as prose, or placed under any other key (\`rationale\`, \`findings\`, …), is INVISIBLE and WILL NOT be fixed. Each \`detail\` states both what is wrong AND how to fix it. Use an empty array \`[]\` when there are no issues.

Emit a block with this EXACT structure, substituting your own real values (this is a filled-in example, not the values to output):
\`\`\`json
{
  "confidence": 80,
  "verdict": "FAIL",
  "dimensions": { "correctness": true, "tests": false, "criteria": true, "security": true },
  "summary": "The change resolves the issue, but the added test asserts nothing and would still pass if the fix were reverted.",
  "issues": [
    { "severity": "high", "title": "Tautological test", "detail": "test/foo.spec.ts asserts true === true; assert the response status is 200 instead so the test fails without the fix.", "file": "test/foo.spec.ts" }
  ]
}
\`\`\`
**The rubric is the gate, not the confidence number.** Set \`verdict\` to "PASS" ONLY when ALL FOUR dimensions are true AND there are no high/critical issues. Mark a dimension false the moment you are not confident it fully holds — err toward false.`;

const RETRY_CONTRACT = `# Retry — your previous output was rejected

IMPORTANT — RETRY: your previous response could not be parsed against the required schema, so this review is being re-run. The verdict was discarded; none of that prior analysis was recorded. Conform EXACTLY this time:
- Your response MUST contain exactly ONE \`\`\`json fenced block (reasoning before it is fine; just no second \`\`\`json block). Do NOT write the verdict to a file (\`review.json\` or similar) and then summarise — the file is ignored; only this inline block is read.
- The block MUST be strict, valid JSON: real values only, with NO \`<...>\` placeholders, NO \`"PASS" | "FAIL"\` alternatives, NO \`//\` comments, and NO trailing commas. These are the usual reasons a block fails to parse.
- \`verdict\` MUST be the string "PASS" or "FAIL" (uppercase) — NOT a boolean (\`true\`/\`false\`), number, or any other word.
- \`confidence\` MUST be present, as an integer 0-100.
- \`dimensions\` MUST contain all four boolean keys: \`correctness\`, \`tests\`, \`criteria\`, \`security\`.
- MOST IMPORTANT — \`issues\`: every concrete problem MUST be a structured object in the \`issues\` array with the exact \`{severity,title,detail,file?}\` shape. This array is the ONLY thing passed to the agent that fixes the code — any finding left out, written as prose, or placed under a stray key (\`rationale\`, \`findings\`, \`explanation\`, …) is INVISIBLE to the fix stage and WILL NOT be fixed. Each \`detail\` must say both what is wrong and how to fix it. Put a FAIL's full reasoning here, not after the block.`;

export function buildReviewPrompt(ctx: ReviewPromptContext): string {
  // Injected documents stay wrapped in `--- NAME --- … ---` fences so their own Markdown headings
  // never read as one of the prompt's own sections (mirrors the implement/revise prompts).
  const context: string[] = [
    `--- ISSUE: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `--- PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
  ];

  if (ctx.humanFeedback) {
    context.push(
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

    context.push(
      `--- ISSUES FROM PRIOR REVIEW PASS (verify each is now resolved) ---\n${formatted}\n--- END PRIOR ISSUES ---\n\nFor each prior issue, explicitly state in your summary whether it is resolved. **If an issue is not fully resolved — including partial fixes — it MUST appear in your JSON "issues" array.** Mentioning it only in the summary is not sufficient; the issues array is the only signal the next revision receives. Then perform a full independent review of all changes to catch any additional problems not listed above.`,
    );
  }

  if (ctx.outOfPlanFiles && ctx.outOfPlanFiles.length > 0) {
    context.push(
      `--- SCOPE CHECK ---\nThese files were changed but aren't in the approved plan's "Files to change". Out-of-plan changes are frequently legitimate: a fix the build/tests required, a shared type/config, or repairing pre-existing breakage in another package/workspace. The VERIFY stage has already PASSED, so any change the green build depends on is in scope by definition — do NOT ask for it to be reverted. Only raise an issue if a change is clearly unrelated to the task, unnecessary for a passing build, AND risky (a genuine regression or accidental edit). A pure "this is beyond the plan" observation is at most "low" severity — NEVER high/critical — and on its own must not set "dimensions.criteria" to false. Files:\n${ctx.outOfPlanFiles.map((f) => `- ${f}`).join('\n')}\n--- END SCOPE CHECK ---`,
    );
  }

  context.push(
    `--- FILES CHANGED ON THIS BRANCH ---\n${ctx.changedFiles.map((f) => `- ${f}`).join('\n') || '(none detected)'}\n--- END FILES CHANGED ---`,
  );

  const parts: string[] = [
    `# Role

You are Hermes acting as a rigorous senior code reviewer for \`${ctx.repoFullName}\`. The working directory contains a branch with changes committed on top of \`${ctx.baseBranch}\`; review the diff of this branch against \`${ctx.baseBranch}\` (use git to inspect it). Use \`.olympian/\` as a scratch directory for temporary files such as diffs — it is excluded from commits automatically.

**This is a read-only review:** do NOT modify any source files and do NOT use the clarify tool. If you find a bug, record it in the issues array — do not fix it. **Your verdict must be returned INLINE in your final message as the JSON block in "# Output" — do NOT write the review or verdict to a file (e.g. \`review.json\`); a file is NEVER read and the review will be discarded as unparseable.**`,
    `# Context\n\n${context.join('\n\n')}`,
    `# Reviewing

Judge whether the changes correctly and completely resolve the issue, satisfy the plan's acceptance criteria, and meet a professional bar for correctness, security, and tests.

**Read efficiently, but never review less.** Inspect the FULL diff against \`${ctx.baseBranch}\` — every changed file and every hunk. When you need surrounding context (a changed function's callers, a type or constant it relies on, related logic, the tests that cover it), use \`search_files\` to read the specific 20-40 line window instead of loading whole files. This is purely about HOW you read: a lean context won't get compressed mid-review, which is exactly when defects slip through. It must never narrow WHAT you review — follow the diff outward wherever a change could introduce a bug (broken callers, unhandled edge cases, security or data-loss risks, missing or weak tests), and do a complete independent pass even on hunks that look fine. If understanding a change demands reading more, read more.`,
    TESTS_CONTRACT,
  ];

  if (ctx.hasBrowser) {
    parts.push(BROWSER_CONTRACT);
  }

  parts.push(AUTONOMY_NOTICE, VERDICT_CONTRACT);

  if (ctx.parseRetry) {
    parts.push(RETRY_CONTRACT);
  }

  return parts.join('\n\n');
}
