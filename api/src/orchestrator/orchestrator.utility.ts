import { type Command } from './orchestrator.model.js';
import { type DownloadedAttachment } from '../workspace/workspace.model.js';

const APPROVE_VERBS = new Set(['approve', 'approved', 'lgtm', 'ship', 'go']);
const CANCEL_VERBS = new Set(['cancel', 'stop', 'abort']);
const REVISE_VERBS = new Set(['revise', 'iterate', 'change', 'update']);
const RETRY_VERBS = new Set(['retry', 'restart', 'resume']);

/**
 * Parses a `<prefix> <verb> [text]` command out of a comment body. Returns
 * { kind: 'none' } when no command line is present — callers treat that as plan
 * iteration feedback.
 */
export function parseCommand(body: string, prefix: string): Command {
  const lower = prefix.toLowerCase();

  for (const raw of body.split('\n')) {
    const line = raw.trim();

    if (!line.toLowerCase().startsWith(lower)) {
      continue;
    }

    const rest = line.slice(prefix.length).trim();
    const [verb = '', ...args] = rest.split(/\s+/);
    const v = verb.toLowerCase();

    if (APPROVE_VERBS.has(v)) {
      return { kind: 'approve' };
    }

    if (CANCEL_VERBS.has(v)) {
      return { kind: 'cancel' };
    }

    if (v === 'status') {
      return { kind: 'status' };
    }

    if (RETRY_VERBS.has(v)) {
      return { kind: 'retry' };
    }

    if (REVISE_VERBS.has(v)) {
      return { kind: 'revise', text: args.join(' ') };
    }

    return { kind: 'none' };
  }
  return { kind: 'none' };
}

const STATE_LABELS: Record<string, string> = {
  TRIAGED: 'waiting to start',
  PLANNING: 'agent is writing a plan',
  AWAITING_PLAN_APPROVAL: 'waiting for plan approval',
  IMPLEMENTING: 'agent is writing code',
  VERIFYING: 'running tests/build',
  SELF_REVIEWING: 'agent is reviewing its own changes',
  REVISING: 'agent is revising code after review feedback',
  OPENING_PR: 'opening a pull request',
  AWAITING_PR_APPROVAL: 'PR is open, awaiting human review',
  DONE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export interface StatusContext {
  state: string;
  confidence?: number | null;
  error?: string | null;
  prNumber?: number | null;
  activeRunPhase?: string | null;
  activeRunStartedAt?: Date | null;
  reviewPassCount: number;
  activeTask?: { attempts: number; maxAttempts: number; lastError?: string | null } | null;
  commandPrefix: string;
  lastReviewIssues?: string;
  lastReviewIssueCount?: number;
  /** Last verify result: true=green, false=red, null=no command discovered. */
  verifyOk?: boolean | null;
  /** Rubric dimensions the last review marked as failing. */
  failedChecks?: string[];
}

export function buildStatusReport(ctx: StatusContext): string {
  const label = STATE_LABELS[ctx.state] ?? ctx.state.toLowerCase().replace(/_/g, ' ');
  const lines: string[] = [`**Status: ${ctx.state}** — ${label}`];

  if (ctx.activeRunPhase && ctx.activeRunStartedAt) {
    const elapsed = Math.round((Date.now() - ctx.activeRunStartedAt.getTime()) / 60_000);
    const duration = elapsed < 1 ? 'just started' : `${elapsed} min`;
    lines.push(`- **Agent phase:** ${ctx.activeRunPhase} (running for ${duration})`);
  }

  if (ctx.reviewPassCount > 0 || ctx.state === 'SELF_REVIEWING' || ctx.state === 'REVISING') {
    const passLine = `- **Review passes completed:** ${ctx.reviewPassCount}`;
    lines.push(
      ctx.confidence != null
        ? `${passLine} — last confidence: ${ctx.confidence}/100 (advisory)`
        : passLine,
    );
  } else if (ctx.confidence != null) {
    lines.push(`- **Last review confidence:** ${ctx.confidence}/100 (advisory)`);
  }

  if (ctx.verifyOk != null) {
    lines.push(`- **Tests/build:** ${ctx.verifyOk ? '✅ passing' : '❌ failing'}`);
  }

  if (ctx.failedChecks && ctx.failedChecks.length > 0) {
    lines.push(`- **Failing review checks:** ${ctx.failedChecks.join(', ')}`);
  }

  if (ctx.prNumber) {
    lines.push(`- **Pull request:** #${ctx.prNumber}`);
  }

  if (ctx.activeTask && ctx.activeTask.attempts > 1) {
    lines.push(`- **Task attempt:** ${ctx.activeTask.attempts}/${ctx.activeTask.maxAttempts}`);
  }

  if (ctx.activeTask?.lastError) {
    lines.push(`- **Last error:** \`${ctx.activeTask.lastError.slice(0, 300)}\``);
  } else if (ctx.state === 'FAILED' && ctx.error) {
    lines.push('', `**Last error:** \`${ctx.error.slice(0, 300)}\``);
  }

  if (ctx.lastReviewIssues && ctx.lastReviewIssueCount) {
    const n = ctx.lastReviewIssueCount;
    lines.push(
      '',
      `<details><summary>Last review findings (${n} issue${n === 1 ? '' : 's'})</summary>`,
      '',
      ctx.lastReviewIssues,
      '',
      '</details>',
    );
  }

  if (ctx.state === 'AWAITING_PLAN_APPROVAL') {
    lines.push(
      '',
      `Reply with **\`${ctx.commandPrefix} approve\`** to start implementation, or leave a comment with corrections.`,
    );
  } else if (ctx.state === 'AWAITING_PR_APPROVAL') {
    lines.push('', 'Review and approve the pull request above to complete the job.');
  }

  return lines.join('\n');
}

/** Formats a list of downloaded workspace-relative attachment paths for inclusion in a prompt. */
export function formatDownloadedAttachments(
  attachments: DownloadedAttachment[],
): string | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  return (
    'The following files were attached to the issue or comments and have been downloaded to your workspace:\n' +
    attachments.map((a) => `- \`${a.relativePath}\``).join('\n') +
    '\nUse them as reference material or incorporate them into the implementation as appropriate.'
  );
}
