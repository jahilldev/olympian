export type ReviewVerdict = 'PASS' | 'FAIL';

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ReviewPassDto {
  id: string;
  cycle: number;
  passNumber: number;
  confidence: number;
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
  createdAt: string;
}

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
  humanFeedback?: string;
  /** Issues raised by the immediately preceding review pass — verify each is resolved. */
  priorIssues?: ReviewIssue[];
  /** When true, a Camofox browser is reachable — include browser verification instructions. */
  hasBrowser?: boolean;
  /** Set when retrying after an unparseable response to prompt for JSON-only output. */
  parseRetry?: boolean;
}
