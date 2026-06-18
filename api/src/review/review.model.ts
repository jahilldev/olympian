export type ReviewVerdict = 'PASS' | 'FAIL';

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Rubric dimensions the reviewer grades independently. Each is a hard gate: the
 * verdict can only be PASS if every dimension holds. Confidence is advisory only.
 */
export const REVIEW_DIMENSIONS = ['correctness', 'tests', 'planCoverage', 'security'] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];
export type ReviewDimensions = Record<ReviewDimension, boolean>;

export interface ReviewPassDto {
  id: string;
  cycle: number;
  passNumber: number;
  confidence: number;
  verdict: ReviewVerdict;
  dimensions: ReviewDimensions | null;
  verifyOk: boolean | null;
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
  confidence: number; // 0-100, advisory only — not part of the pass gate
  verdict: ReviewVerdict;
  dimensions: ReviewDimensions;
  issues: ReviewIssue[];
  summary?: string;
  /** Result of the orchestrator-run VERIFY_COMMAND. null when no command is configured. */
  verifyOk: boolean | null;
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
  /** Ground-truth result of the orchestrator-run VERIFY_COMMAND, surfaced to the reviewer. */
  verify?: { ok: boolean; output: string };
  /** Files changed on the branch that the approved plan never mentioned (possible scope creep). */
  outOfPlanFiles?: string[];
}
