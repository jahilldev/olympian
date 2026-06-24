export interface ImplementPromptContext {
  jobId: string;
  repoFullName: string;
  issueTitle: string;
  issueBody: string;
  plan: string;
  attempt: number;
  /** Pre-formatted extra guidance: prior review issues or PR-review feedback. */
  guidance?: string;
  attachments?: string;
  /** Durable working memory (.olympian/PROGRESS.md) from an earlier pass, injected so a resume doesn't depend on the agent reading it. */
  progress?: string;
}
