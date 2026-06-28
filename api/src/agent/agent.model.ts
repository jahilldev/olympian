export const AGENT_PHASES = [
  'PLAN',
  'IMPLEMENT',
  'REVIEW',
  'REVISE',
  'SUMMARY',
  'VERIFY',
  'JUDGE',
  'CHAT',
  'TITLE',
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
  /** For JUDGE runs: the completion judge's verdict (did the work pass?). null otherwise. */
  judgePassed?: boolean | null;
}

export interface AgentRunOutputDto {
  stdout: string;
  stderr: string | null;
}

/** Caps so a runaway agent can't blow up memory or the SQLite row. */
export const STDOUT_CAP = 200_000;

/**
 * How often (ms) a running agent's streamed Langfuse events are flushed to AgentEvent. Events are
 * persisted incrementally rather than only at completion, so a crashed/killed run still leaves a
 * full paper trail and a long run isn't truncated by the in-memory display buffer cap. A crash
 * loses at most this window of un-flushed events.
 */
export const EVENT_FLUSH_INTERVAL_MS = 1_000;

export interface AgentRunOptions {
  /** Owning job, for delivery-pipeline runs. Omitted (with `sessionId` set) for CHAT runs. */
  jobId?: string;
  /** Owning chat session, for CHAT-phase runs. Mutually exclusive with `jobId`. */
  sessionId?: string;
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
  /**
   * Invoked with the AgentRun id as soon as the run row is created (before the agent
   * process finishes). Lets a caller hand the id to a live SSE subscriber while the run
   * proceeds in the background — used by chat, where the HTTP response returns the runId
   * immediately.
   */
  onStart?: (runId: string) => void;
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
