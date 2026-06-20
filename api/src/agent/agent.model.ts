export const AGENT_PHASES = [
  'PLAN',
  'IMPLEMENT',
  'REVIEW',
  'REVISE',
  'SUMMARY',
  'VERIFY',
  'JUDGE',
] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export type AgentRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';

export interface AgentRunDto {
  id: string;
  phase: AgentPhase;
  model: string | null;
  status: AgentRunStatus;
  exitCode: number | null;
  durationMs: number | null;
  hasOutput: boolean;
  createdAt: string;
  /** For JUDGE runs: whether the completion judge found the acceptance criteria met. null otherwise. */
  judgeMet?: boolean | null;
}

export interface AgentRunOutputDto {
  stdout: string;
  stderr: string | null;
}

/** Caps so a runaway agent can't blow up memory or the SQLite row. */
export const STDOUT_CAP = 200_000;

export interface AgentRunOptions {
  jobId: string;
  phase: AgentPhase;
  /** Absolute working directory the agent runs in (its repo worktree). */
  cwd: string;
  /** The full prompt, assembled from DB context by the orchestrator. */
  prompt: string;
  /** Optional Hermes toolset CSV (`-t`). */
  toolsets?: string;
  /** Optional Hermes skills to preload (`--skills`, repeatable). */
  skills?: string[];
  /** Override the wall-clock timeout for this invocation. */
  timeoutMs?: number;
  /** Override the model for this specific invocation (e.g. a review-only model). */
  model?: string;
  /** Override the provider for this specific invocation. */
  provider?: string;
  /**
   * Post-hoc check on stdout for a cleanly-exited run. Return a reason string to mark
   * the run FAILED despite exit 0 (e.g. a premature/cut-off turn), or null if it looks
   * complete. Lets the recorded status and metric reflect the true outcome.
   */
  validate?: (stdout: string) => string | null;
}

export interface AgentRunResult {
  runId: string;
  status: AgentRunStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** Set when running in docker mode; used to force-remove the container on kill. */
  containerName?: string;
}

export interface RawSpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}
