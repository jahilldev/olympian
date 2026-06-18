import { type VerifyRun } from '@prisma/client';
import { extractJsonBlock } from '../agent/agent.utility.js';
import { type VerifyRunDto } from './verify.model.js';

/**
 * Extracts the verification command from the discovery agent's stdout. Returns the
 * trimmed command, or an empty string when the output is unparseable or the agent
 * reported that the repo has no automated checks. The orchestrator treats an empty
 * string as "no gate".
 */
export function parseVerifyCommand(stdout: string): string {
  const parsed = extractJsonBlock(stdout) as { command?: unknown } | null;

  return parsed && typeof parsed.command === 'string' ? parsed.command.trim() : '';
}

/** Maps a persisted VerifyRun row to its UI DTO. */
export function toDto(run: VerifyRun): VerifyRunDto {
  return {
    id: run.id,
    cycle: run.cycle,
    attempt: run.attempt,
    command: run.command,
    ok: run.ok,
    output: run.output,
    durationMs: run.durationMs,
    createdAt: run.createdAt.toISOString(),
  };
}
