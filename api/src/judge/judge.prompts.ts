import { type JudgePromptContext } from './judge.model.js';

export function buildJudgePrompt(ctx: JudgePromptContext): string {
  const passKind = ctx.phase === 'IMPLEMENT' ? 'an implementation' : 'a revision';

  return [
    `You are Hermes acting as a strict completion judge for \`${ctx.repoFullName}\`. An agent just finished ${passKind} pass; its changes are committed on a branch over \`${ctx.baseBranch}\`. Your ONLY job is to decide whether the agent FULLY completed the work, or stopped early with work still remaining.`,
    `--- GOAL (everything that must be fully done) ---\n${ctx.goal}\n--- END GOAL ---`,
    `--- THE AGENT'S FINAL MESSAGE ---\n${ctx.agentOutput.slice(0, 8000)}\n--- END MESSAGE ---`,
    `Judge by EVIDENCE in the committed changes, not by the agent's claims. Inspect the diff against \`${ctx.baseBranch}\` with git and read files as needed. Use \`.olympian/\` as a scratch directory. **This is read-only: do NOT modify any files and do NOT use the clarify tool.**`,
    `Set **\`passed\`** to true ONLY if EVERY item in the goal is actually present in the committed changes, OR the agent has hit a genuine blocker that truly requires human input. Set it **false** if the final message lists remaining tasks, says things like "now I need to…", "next", "TODO", "still to do", or otherwise signals unfinished work — even if what's there so far looks correct. When you are unsure, lean toward **false**.`,
    `**Tests are mandatory, not optional.** This project is test-driven: \`passed\` is **false** unless EVERY acceptance criterion is covered by an automated test that genuinely exercises the new behaviour — one that would FAIL without the implementation. Confirm the diff actually adds or updates such tests (the repo's own framework; a runner should be set up if none existed). Treat missing tests, tests that don't assert the new behaviour, and trivial/tautological/assertion-free tests as a failure, and say exactly which criteria still need real test coverage. The ONLY exception is a change with genuinely nothing to assert (e.g. docs or static assets).`,
    `Output ONLY this JSON as the FIRST thing in your response, before any other text:
\`\`\`json
{
  "passed": true | false,
  "critique": "<if not passed: a concise, specific, actionable checklist of exactly what still needs doing; if passed: an empty string>"
}
\`\`\`
The "critique" is handed verbatim to the next agent as its to-do list, so be specific (name files, functions, and the concrete remaining steps). You may add brief reasoning after the JSON block.`,
  ].join('\n\n');
}
