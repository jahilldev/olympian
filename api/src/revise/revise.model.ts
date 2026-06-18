export interface RevisePromptContext {
  jobId: string;
  plan: string;
  latestIssuesText?: string;
  priorIssuesText?: string;
  humanFeedback?: string;
}
