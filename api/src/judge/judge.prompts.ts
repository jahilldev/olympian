import { type JudgePromptContext } from './judge.model.js';

const TESTS_CONTRACT = `# Tests

**Tests are mandatory, not optional.** This project is test-driven: \`passed\` is **false** unless EVERY acceptance criterion is covered by an automated test that genuinely exercises the new behaviour — one that would FAIL without the implementation. Confirm the diff actually adds or updates such tests (the repo's own framework; a runner should be set up if none existed). Treat missing tests, tests that don't assert the new behaviour, and trivial/tautological/assertion-free tests as a failure, and say exactly which criteria still need real test coverage. The ONLY exception is a change with genuinely nothing to assert (e.g. docs or static assets).`;

const OUTPUT_CONTRACT = `# Output — verdict + critique

Begin your response with a JSON block containing ONLY the verdict, then — if not passed — the critique as ordinary markdown beneath it:
\`\`\`json
{"passed": true | false}
\`\`\`

## Critique

Under that heading, if not passed, write a concise, specific, actionable checklist of exactly what still needs doing — name files, functions, and the concrete remaining steps. This is plain markdown handed to the next agent as its to-do list, so code fences, quotes and lists are all fine and need no escaping (the verdict above is the only JSON). Use nested headings/sub-bullets freely to group the work — the orchestrator re-levels your heading depths to fit the next prompt, so just keep the structure internally consistent. If passed, instead write a short summary of what you found. Keep the JSON block exactly as shown — \`passed\` is the only field, and the critique never goes inside it.`;

export function buildJudgePrompt(ctx: JudgePromptContext): string {
  const passKind = ctx.phase === 'IMPLEMENT' ? 'an implementation' : 'a revision';

  // Injected documents stay wrapped in `--- NAME --- … ---` fences so their own Markdown headings
  // never read as one of the prompt's own sections (mirrors the implement/revise/review prompts).
  const context: string[] = [
    `--- GOAL (everything that must be fully done) ---\n${ctx.goal}\n--- END GOAL ---`,
  ];

  if (ctx.context) {
    context.push(
      `--- CONTEXT (e.g the original approved plan, for CONTEXT only) ---\n${ctx.context.slice(0, 8000)}\n--- END CONTEXT ---\n\nThis is background ONLY and must NOT affect your verdict — \`passed\` is decided solely by the GOAL above. Never set \`passed\` to false for anything here that is outside the goal. If you notice the changes regress or contradict something in this context, note it in the critique for human reviewers; it never flips the verdict on its own.`,
    );
  }

  context.push(
    `--- THE AGENT'S FINAL MESSAGE ---\n${ctx.agentOutput.slice(0, 8000)}\n--- END MESSAGE ---`,
  );

  return [
    `# Role

You are Hermes acting as a strict completion judge for \`${ctx.repoFullName}\`. An agent just finished ${passKind} pass; its changes are committed on a branch over \`${ctx.baseBranch}\`. Your ONLY job is to decide whether the agent FULLY completed the work, or stopped early with work still remaining.`,
    `# Context\n\n${context.join('\n\n')}`,
    `# Judging

Judge by EVIDENCE in the committed changes, not by the agent's claims. Inspect the diff against \`${ctx.baseBranch}\` with git and read files as needed. Use \`.olympian/\` as a scratch directory. **This is read-only: do NOT modify any files and do NOT use the clarify tool.**

Set **\`passed\`** to true ONLY if EVERY item in the goal is actually present in the committed changes, OR the agent has hit a genuine blocker that truly requires human input. Set it **false** if the final message lists remaining tasks, says things like "now I need to…", "next", "TODO", "still to do", or otherwise signals unfinished work — even if what's there so far looks correct. When you are unsure, lean toward **false**.`,
    TESTS_CONTRACT,
    OUTPUT_CONTRACT,
  ].join('\n\n');
}
