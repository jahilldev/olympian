import { ALLOWED_TRANSITIONS, type JobState, TERMINAL_STATES } from './job.model.js';

/** Whether `to` is a legal next state from `from`. */
export function canTransition(from: JobState, to: JobState): boolean {
  if (TERMINAL_STATES.has(from)) {
    return false;
  }
  // Bail-outs are always allowed from any non-terminal state.
  if (to === 'FAILED' || to === 'CANCELLED') {
    return true;
  }
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function repoFullName(owner: string, name: string): string {
  return `${owner}/${name}`;
}

/** Branch name for a job, e.g. "hermes/issue-42". */
export function branchNameFor(prefix: string, issueNumber: number): string {
  return `${prefix}${issueNumber}`;
}
