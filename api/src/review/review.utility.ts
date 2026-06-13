import { z } from 'zod';
import { extractJsonBlock } from '../agent/agent.utility.js';
import { type ReviewIssue, type ReviewResult } from './review.model.js';

const issueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']).catch('medium'),
  title: z.string().default('issue'),
  detail: z.string().default(''),
  file: z.string().optional(),
});

const reviewSchema = z.object({
  confidence: z.coerce.number().int().min(0).max(100),
  verdict: z.enum(['PASS', 'FAIL']).optional(),
  summary: z.string().optional(),
  issues: z.array(issueSchema).default([]),
});

/**
 * Parses the agent's review stdout into a structured result. Returns null when no
 * JSON verdict can be recovered (caller treats that as a failed review pass).
 */
export function parseReview(stdout: string): ReviewResult | null {
  const raw = extractJsonBlock(stdout);
  const parsed = reviewSchema.safeParse(raw);

  if (!raw || !parsed.success) {
    return null;
  }

  const data = parsed.data;
  const issues: ReviewIssue[] = data.issues;
  const hasBlocking = issues.some((i) => i.severity === 'high' || i.severity === 'critical');

  // Trust an explicit verdict; otherwise derive a conservative one.
  const verdict = data.verdict ?? (hasBlocking ? 'FAIL' : 'PASS');

  return { confidence: data.confidence, verdict, issues, summary: data.summary };
}

export function meetsThreshold(result: ReviewResult, threshold: number): boolean {
  const hasBlocking = result.issues.some((i) => i.severity === 'high' || i.severity === 'critical');

  return result.verdict === 'PASS' && result.confidence >= threshold && !hasBlocking;
}

/** Human/agent-readable rendering of issues for a revise prompt or a PR comment. */
export function formatIssues(issues: ReviewIssue[]): string {
  if (issues.length === 0) {
    return '(no specific issues listed)';
  }

  return issues
    .map((i, n) => {
      const loc = i.file ? ` (${i.file})` : '';
      return `${n + 1}. [${i.severity}] ${i.title}${loc}\n   ${i.detail}`;
    })
    .join('\n');
}

const SEVERITY_EMOJI: Record<ReviewIssue['severity'], string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
};

/** GitHub Markdown rendering of issues for human-readable status comments. */
export function formatIssuesMarkdown(issues: ReviewIssue[]): string {
  if (issues.length === 0) {
    return '_(no specific issues listed)_';
  }

  return issues
    .map((i) => {
      const emoji = SEVERITY_EMOJI[i.severity] ?? '⚪';
      const loc = i.file ? ` \`${i.file}\`` : '';
      return `${emoji} **${i.severity} —** **${i.title}**${loc}\n${i.detail}`;
    })
    .join('\n\n');
}
