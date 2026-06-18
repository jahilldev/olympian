export interface VerifyPromptContext {
  repoFullName: string;
}

export interface RecordVerifyInput {
  jobId: string;
  cycle: number;
  attempt: number;
  command: string;
  ok: boolean;
  output: string;
  durationMs: number;
}

export interface VerifyRunDto {
  id: string;
  cycle: number;
  attempt: number;
  command: string;
  ok: boolean;
  output: string;
  durationMs: number;
  createdAt: string;
}

// Cap stored verify output so a noisy build log can't bloat the row.
export const VERIFY_OUTPUT_CAP = 50_000;
