import { extractJsonBlock } from '../agent/agent.utility.js';

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
