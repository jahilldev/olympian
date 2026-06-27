/** Completion judge: decides whether an IMPLEMENT/REVISE pass actually finished its work. */
export interface JudgePromptContext {
  repoFullName: string;
  baseBranch: string;
  phase: 'IMPLEMENT' | 'REVISE';
  /** What must be fully done — the plan's acceptance criteria (IMPLEMENT) or the issues to fix (REVISE). */
  goal: string;
  /** The original approved plan, supplied as background context (not the pass/fail bar) — e.g. for
   * REVISE, so the judge can flag a fix that regresses a plan requirement. Omitted when the goal
   * already is the plan (IMPLEMENT). */
  context?: string;
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
  passed: boolean;
  /** When not passed, a specific, actionable list of what remains — fed to the next agent (with its
   * heading hierarchy re-leveled to nest cleanly under the prompt). Stored verbatim for humans. */
  critique: string;
}

export interface JudgementDto {
  id: string;
  passed: boolean | null;
  /** The judge agent's full output (verdict block + reasoning), like any other run's stdout. */
  output: string;
  createdAt: string;
}

// A judge call is a focused evaluation, not a full work session — cap it well under the
// main agent budget so a stuck judge can't stall the loop for hours.
export const JUDGE_TIMEOUT_MS = 30 * 60 * 1000;
