export interface RunMeta {
  phase: string;
  model: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
}

export const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT']);
