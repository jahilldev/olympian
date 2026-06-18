export interface RevisePromptContext {
  jobId: string;
  plan: string;
  /** Output of a failing verify command (tests/build) — the highest-priority fix. */
  verifyFailure?: string;
  latestIssuesText?: string;
  priorIssuesText?: string;
  humanFeedback?: string;
}
