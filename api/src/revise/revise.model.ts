export interface RevisePromptContext {
  jobId: string;
  plan: string;
  /** Output of a failing verify command (tests/build) — the highest-priority fix. */
  verifyFailure?: string;
  latestIssuesText?: string;
  priorIssuesText?: string;
  humanFeedback?: string;
  /** Pre-formatted list of downloaded attachment file paths the agent can open locally. */
  attachments?: string;
  /** Set on a completion-judge continuation: what the previous pass left unfinished. */
  incompleteWork?: string;
  /** Durable working memory (.olympian/PROGRESS.md) from an earlier pass, injected so a resume doesn't depend on the agent reading it. */
  progress?: string;
}
