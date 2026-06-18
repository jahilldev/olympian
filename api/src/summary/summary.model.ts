export interface SummaryPromptContext {
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  baseBranch: string;
  branchName: string;
}

export interface PrBodyInput {
  issueNumber: number;
  agentSummary: string;
  confidence: number | null;
  meetsThreshold: boolean;
  verifyOk: boolean | null;
  failedDimensions: string[];
  unresolvedIssues?: string;
}
