import { z } from 'zod';
import { extractJsonBlock } from '../agent/agent.utility.js';
import {
  REVIEW_DIMENSIONS,
  type ReviewDimension,
  type ReviewDimensions,
  type ReviewIssue,
  type ReviewResult,
} from './review.model.js';

const issueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']).catch('medium'),
  title: z.string().default('issue'),
  detail: z.string().default(''),
  file: z.string().optional(),
});

// Accepts booleans or the common stringy forms an LLM emits ("pass"/"fail",
// "yes"/"no", "true"/"false"). Anything unrecognised falls through to the default.
const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['pass', 'passed', 'yes', 'true', 'ok', 'y', '1'].includes(s)) {
      return true;
    }
    if (['fail', 'failed', 'no', 'false', 'n', '0'].includes(s)) {
      return false;
    }
  }
  return undefined;
}, z.boolean().default(true));

// Tolerate snake_case / loose key names for the multi-word dimension.
const dimensionsSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== 'object') {
      return {};
    }
    const o = v as Record<string, unknown>;
    return {
      correctness: o.correctness,
      tests: o.tests,
      planCoverage: o.planCoverage ?? o.plan_coverage ?? o.coverage,
      security: o.security,
    };
  },
  z.object({
    correctness: boolish,
    tests: boolish,
    planCoverage: boolish,
    security: boolish,
  }),
);

const reviewSchema = z.object({
  confidence: z.coerce.number().int().min(0).max(100),
  verdict: z.enum(['PASS', 'FAIL']).optional(),
  summary: z.string().optional(),
  dimensions: dimensionsSchema.optional(),
  issues: z.array(issueSchema).default([]),
});

const ALL_DIMENSIONS_PASS: ReviewDimensions = {
  correctness: true,
  tests: true,
  planCoverage: true,
  security: true,
};

function allDimensionsPass(dims: ReviewDimensions): boolean {
  return REVIEW_DIMENSIONS.every((d) => dims[d]);
}

function hasBlockingIssue(issues: ReviewIssue[]): boolean {
  return issues.some((i) => i.severity === 'high' || i.severity === 'critical');
}

/**
 * Parses the agent's review stdout into a structured result. Returns null when no
 * JSON verdict can be recovered (caller treats that as a failed review pass).
 * `verifyOk` is filled in by the orchestrator after running VERIFY_COMMAND; the
 * model never reports it, so it is left null here.
 */
export function parseReview(stdout: string): ReviewResult | null {
  const raw = extractJsonBlock(stdout);
  const parsed = reviewSchema.safeParse(raw);

  if (!raw || !parsed.success) {
    return null;
  }

  const data = parsed.data;
  const issues: ReviewIssue[] = data.issues;
  const dimensions: ReviewDimensions = data.dimensions ?? ALL_DIMENSIONS_PASS;
  const blocking = hasBlockingIssue(issues);

  // Trust an explicit verdict; otherwise derive a conservative one from the rubric.
  const verdict = data.verdict ?? (blocking || !allDimensionsPass(dimensions) ? 'FAIL' : 'PASS');

  return {
    confidence: data.confidence,
    verdict,
    dimensions,
    issues,
    summary: data.summary,
    verifyOk: null,
  };
}

/**
 * Rebuilds a ReviewResult from a persisted ReviewPass row so the gate can be
 * re-evaluated later (e.g. at OPEN_PR time) without re-running the reviewer.
 */
export function reviewResultFromRecord(rec: {
  confidence: number;
  verdict: string;
  dimensions: string | null;
  verifyOk: boolean | null;
  issues: string;
}): ReviewResult {
  let issues: ReviewIssue[] = [];

  try {
    issues = JSON.parse(rec.issues) as ReviewIssue[];
  } catch {
    // malformed — treat as no issues
  }

  let dimensions: ReviewDimensions = ALL_DIMENSIONS_PASS;

  try {
    dimensions = rec.dimensions
      ? (JSON.parse(rec.dimensions) as ReviewDimensions)
      : ALL_DIMENSIONS_PASS;
  } catch {
    // malformed — fall back to all-pass (issues/verify still gate)
  }

  return {
    confidence: rec.confidence,
    verdict: rec.verdict === 'PASS' ? 'PASS' : 'FAIL',
    dimensions,
    issues,
    verifyOk: rec.verifyOk,
  };
}

/**
 * The pass gate. Confidence is deliberately NOT part of it — it is advisory only.
 * A change passes when the reviewer's verdict is PASS, every rubric dimension
 * holds, there are no high/critical issues, and the verify command (if configured)
 * is green. `verifyOk === null` means no command is configured, which never blocks.
 */
export function meetsThreshold(result: ReviewResult): boolean {
  return (
    result.verdict === 'PASS' &&
    allDimensionsPass(result.dimensions) &&
    !hasBlockingIssue(result.issues) &&
    result.verifyOk !== false
  );
}

const DIMENSION_LABELS: Record<ReviewDimension, string> = {
  correctness: 'correctness',
  tests: 'tests',
  planCoverage: 'plan coverage',
  security: 'security',
};

/** Rubric dimensions that the reviewer marked as failing. */
export function failedDimensions(dims: ReviewDimensions): string[] {
  return REVIEW_DIMENSIONS.filter((d) => !dims[d]).map((d) => DIMENSION_LABELS[d]);
}

/** Compact one-line rubric rendering, e.g. "correctness ✓ · tests ✗ · …". */
export function formatDimensions(dims: ReviewDimensions): string {
  return REVIEW_DIMENSIONS.map((d) => `${DIMENSION_LABELS[d]} ${dims[d] ? '✓' : '✗'}`).join(' · ');
}

/** True when a changed file is covered by one of the plan's declared paths. */
function pathCoveredByPlan(changed: string, planPaths: string[]): boolean {
  const changedBase = changed.split('/').pop();

  return planPaths.some((p) => {
    if (changed === p || changed.endsWith(`/${p}`) || p.endsWith(`/${changed}`)) {
      return true;
    }
    // Match on basename too so a plan that lists a bare filename still covers it.
    return !!changedBase && p.split('/').pop() === changedBase;
  });
}

/** Files changed on the branch that the plan never declared — candidate scope creep. */
export function outOfPlanChanges(changedFiles: string[], planPaths: string[]): string[] {
  if (planPaths.length === 0) {
    return [];
  }

  return changedFiles.filter((f) => !pathCoveredByPlan(f, planPaths));
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
