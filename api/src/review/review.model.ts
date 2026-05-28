export type ReviewVerdict = 'PASS' | 'FAIL';

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ReviewIssue {
  severity: IssueSeverity;
  title: string;
  detail: string;
  file?: string;
}

export interface ReviewResult {
  confidence: number; // 0-100
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
  summary?: string;
}

export interface ReviewPromptContext {
  repoFullName: string;
  issueTitle: string;
  issueBody: string;
  plan: string;
  baseBranch: string;
  changedFiles: string[];
  threshold: number;
}
