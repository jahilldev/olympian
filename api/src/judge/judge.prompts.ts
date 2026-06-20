import { type JudgePromptContext } from './judge.model.js';

export function buildJudgePrompt(ctx: JudgePromptContext): string {
  const passKind = ctx.phase === 'IMPLEMENT' ? 'an implementation' : 'a revision';

  return [
    `You are Hermes acting as a strict completion judge for \`${ctx.repoFullName}\`. An agent just finished ${passKind} pass; its changes are committed on a branch over \`${ctx.baseBranch}\`. Your ONLY job is to decide whether the agent FULLY completed the work, or stopped early with work still remaining.`,
    `--- GOAL (everything that must be fully done) ---\n${ctx.goal}\n--- END GOAL ---`,
    `--- THE AGENT'S FINAL MESSAGE ---\n${ctx.agentOutput.slice(0, 8000)}\n--- END MESSAGE ---`,
    `Judge by EVIDENCE in the committed changes, not by the agent's claims. Inspect the diff against \`${ctx.baseBranch}\` with git and read files as needed. Use \`.olympian/\` as a scratch directory. **This is read-only: do NOT modify any files and do NOT use the clarify tool.**`,
    `Mark the work **met** ONLY if EVERY item in the goal is actually present in the committed changes, OR the agent has hit a genuine blocker that truly requires human input. It is **NOT met** if the final message lists remaining tasks, says things like "now I need to…", "next", "TODO", "still to do", or otherwise signals unfinished work — even if what's there so far looks correct. When you are unsure, lean toward NOT met.`,
    `Output ONLY this JSON as the FIRST thing in your response, before any other text:
\`\`\`json
{
  "met": true | false,
  "critique": "<if not met: a concise, specific, actionable checklist of exactly what still needs doing; if met: an empty string>"
}
\`\`\`
The "critique" is handed verbatim to the next agent as its to-do list, so be specific (name files, functions, and the concrete remaining steps). You may add brief reasoning after the JSON block.`,
  ].join('\n\n');
}
