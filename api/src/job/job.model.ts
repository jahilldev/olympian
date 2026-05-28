// JobState/Actor/PlanRevisionStatus are stored as plain strings in SQLite; these
// unions + the transition map are the authoritative definitions.

export const JOB_STATES = [
  'TRIAGED',
  'PLANNING',
  'AWAITING_PLAN_APPROVAL',
  'IMPLEMENTING',
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
  IMPLEMENTING: ['SELF_REVIEWING'],
  SELF_REVIEWING: ['REVISING', 'OPENING_PR'],
  REVISING: ['SELF_REVIEWING'],
  OPENING_PR: ['AWAITING_PR_APPROVAL'],
  AWAITING_PR_APPROVAL: ['IMPLEMENTING', 'DONE'],
  DONE: [],
  FAILED: [],
  CANCELLED: [],
};

export interface TransitionOptions {
  reason?: string;
  actor?: Actor;
}

export interface CreateJobInput {
  installationId: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  triggerLabel: string;
}
