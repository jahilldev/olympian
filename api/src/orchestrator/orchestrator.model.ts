import { IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';

// SSH remote forms accepted for dashboard jobs: scp-style (git@host:path) or ssh:// URL.
export const SSH_REMOTE_REGEX = /^(?:[^@\s]+@[^:\s]+:.+|ssh:\/\/.+)$/;
const SSH_MESSAGE = 'repoUrl must be an SSH remote (git@host:path or ssh://…)';

/** Body for `POST /api/jobs` — create a dashboard job. */
export class CreateDashboardJobDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  requirements!: string;

  @IsOptional()
  @ValidateIf((o: CreateDashboardJobDto) => !!o.repoUrl)
  @Matches(SSH_REMOTE_REGEX, { message: SSH_MESSAGE })
  repoUrl?: string;
}

/** Body for the plan-feedback and request-changes endpoints. */
export class FeedbackBodyDto {
  @IsString()
  @MinLength(1)
  body!: string;
}

/** Body for `PATCH /api/jobs/:id/repo` — set or clear (empty → scratch) the working repo. */
export class SetRepoDto {
  @IsOptional()
  @ValidateIf((o: SetRepoDto) => !!o.repoUrl)
  @Matches(SSH_REMOTE_REGEX, { message: SSH_MESSAGE })
  repoUrl?: string;
}

export interface IssueLabeledEvent {
  installationId: number;
  accountLogin: string;
  accountType: string;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  label: string;
}

export interface IssueCommentEvent {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  author: string;
  body: string;
  isBot: boolean;
}

export type PrReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface PrReviewEvent {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  state: PrReviewState;
  author: string;
  body: string;
  isBot: boolean;
}

export interface PrReviewCommentEvent {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  author: string;
  body: string;
  path: string;
  line: number | null;
  isBot: boolean;
}

export type CommandKind = 'approve' | 'revise' | 'cancel' | 'status' | 'retry' | 'none';

export interface Command {
  kind: CommandKind;
  text?: string;
}

// Comment verbs (after the command prefix) that map to each CommandKind in parseCommand.
export const APPROVE_VERBS = new Set(['approve', 'approved', 'lgtm', 'ship', 'go']);
export const CANCEL_VERBS = new Set(['cancel', 'stop', 'abort']);
export const REVISE_VERBS = new Set(['revise', 'iterate', 'change', 'update']);
export const RETRY_VERBS = new Set(['retry', 'restart', 'resume']);

/** Human-readable label for each job state, shown in the `/hermes status` report. */
export const STATE_LABELS: Record<string, string> = {
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
