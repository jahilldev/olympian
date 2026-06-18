// JobState/Actor/PlanRevisionStatus are stored as plain strings in SQLite; these
// unions + the transition map are the authoritative definitions.

export const JOB_STATES = [
  'TRIAGED',
  'PLANNING',
  'AWAITING_PLAN_APPROVAL',
  'IMPLEMENTING',
  'VERIFYING',
  'SELF_REVIEWING',
  'REVISING',
  'OPENING_PR',
  'AWAITING_PR_APPROVAL',
  'DONE',
  'FAILED',
  'CANCELLED',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['DONE', 'FAILED', 'CANCELLED']);

export type Actor = 'HUMAN' | 'AGENT' | 'SYSTEM';

export type PlanRevisionStatus = 'PROPOSED' | 'APPROVED' | 'SUPERSEDED';

// Allowed forward transitions. FAILED/CANCELLED are reachable from any non-terminal
// state (handled in canTransition), so they are omitted from the per-state lists.
export const ALLOWED_TRANSITIONS: Record<JobState, JobState[]> = {
  TRIAGED: ['PLANNING'],
  PLANNING: ['AWAITING_PLAN_APPROVAL'],
  AWAITING_PLAN_APPROVAL: ['PLANNING', 'IMPLEMENTING'],
  IMPLEMENTING: ['VERIFYING'],
  VERIFYING: ['REVISING', 'SELF_REVIEWING', 'OPENING_PR'],
  SELF_REVIEWING: ['REVISING', 'OPENING_PR'],
  REVISING: ['VERIFYING'],
  OPENING_PR: ['AWAITING_PR_APPROVAL'],
  AWAITING_PR_APPROVAL: ['IMPLEMENTING', 'DONE'],
  DONE: [],
  FAILED: [],
  CANCELLED: [],
};

export interface TransitionOptions {
  reason?: string;
  actor?: Actor;
  /** Skip the canTransition guard. Use only for admin overrides (e.g. retry from FAILED). */
  force?: boolean;
}

// --- UI read-model DTOs ---

export interface TransitionDto {
  id: string;
  fromState: string | null;
  toState: string;
  reason: string | null;
  actor: string;
  createdAt: string;
}

export interface PlanRevisionDto {
  id: string;
  revision: number;
  content: string;
  status: string;
  createdAt: string;
}

export interface FeedbackDto {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ActiveRunDto {
  id: string;
  phase: string;
  model: string | null;
  createdAt: string;
}

export interface ActiveTaskDto {
  kind: string;
  status: string;
  attempts: number;
}

export interface JobSummaryDto {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  state: string;
  confidence: number | null;
  reviewCycle: number;
  prNumber: number | null;
  prUrl: string | null;
  prIsDraft: boolean;
  createdAt: string;
  updatedAt: string;
  activeRun: ActiveRunDto | null;
  activeTask: ActiveTaskDto | null;
}

export interface JobDetailDto extends JobSummaryDto {
  issueBody: string;
  branchName: string | null;
  headSha: string | null;
  error: string | null;
  transitions: TransitionDto[];
  plans: PlanRevisionDto[];
  planFeedback: FeedbackDto[];
  prFeedback: FeedbackDto[];
}

// --- domain types ---

export interface CreateJobInput {
  installationId: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  triggerLabel: string;
}
