/** Completion judge: decides whether an IMPLEMENT/REVISE pass actually finished its work. */
export interface JudgePromptContext {
  repoFullName: string;
  baseBranch: string;
  phase: 'IMPLEMENT' | 'REVISE';
  /** What must be fully done — the plan's acceptance criteria (IMPLEMENT) or the issues to fix (REVISE). */
  goal: string;
  /** The agent's final message from the run being judged. */
  agentOutput: string;
}

export interface JudgeAssessInput extends JudgePromptContext {
  jobId: string;
  /** The agent's worktree — the judge inspects the committed diff here. */
  cwd: string;
  attempt: number;
}

export interface JudgeVerdict {
  /** True when every part of the goal is evidenced in the committed changes (or genuinely blocked). */
  met: boolean;
  /** When not met, a specific, actionable list of what remains — fed verbatim to the next agent. */
  critique: string;
}

export interface JudgementDto {
  id: string;
  met: boolean | null;
  /** The judge agent's full output (verdict block + reasoning), like any other run's stdout. */
  output: string;
  createdAt: string;
}

// A judge call is a focused evaluation, not a full work session — cap it well under the
// main agent budget so a stuck judge can't stall the loop for hours.
export const JUDGE_TIMEOUT_MS = 30 * 60 * 1000;
