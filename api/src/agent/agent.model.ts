export const AGENT_PHASES = ['PLAN', 'IMPLEMENT', 'TEST', 'REVIEW', 'REVISE', 'PR_BODY'] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export type AgentRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';

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
  /** Override the hard (wall-clock) timeout for this invocation. */
  timeoutMs?: number;
  /** Override the idle timeout (silence threshold) for this invocation. */
  idleTimeoutMs?: number;
  /** Override the model for this specific invocation (e.g. a review-only model). */
  model?: string;
  /** Override the provider for this specific invocation. */
  provider?: string;
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
}

export interface RawSpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// ── Prompt context (string-based to keep agent decoupled from other modules) ──
export interface PlanPromptContext {
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  priorPlan?: string;
  feedback?: string[];
  attachments?: string;
}

export interface ImplementPromptContext {
  repoFullName: string;
  issueTitle: string;
  issueBody: string;
  plan: string;
  attempt: number;
  /** Pre-formatted extra guidance: prior review issues or PR-review feedback. */
  guidance?: string;
  attachments?: string;
}

export interface RevisePromptContext {
  plan: string;
  issuesText?: string;
  testOutput?: string;
  humanFeedback?: string;
}

export interface PrBodyPromptContext {
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  baseBranch: string;
  branchName: string;
}

export interface TestPromptContext {
  repoFullName: string;
  issueTitle: string;
  plan: string;
  hasBrowser: boolean;
  priorOutput?: string;
}
