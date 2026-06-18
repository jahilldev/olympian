export const TASK_KINDS = ['PLAN', 'IMPLEMENT', 'VERIFY', 'REVIEW', 'REVISE', 'OPEN_PR'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface EnqueueInput {
  jobId: string;
  kind: TaskKind;
  /** When the task becomes eligible to run. Defaults to now. */
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}
