import { extractJsonBlock } from '../agent/agent.utility.js';
import { type JudgeVerdict } from './judge.model.js';

/**
 * Parses the judge's verdict from its stdout. Returns null when no valid verdict could be
 * extracted (caller decides how to treat an unparseable judge — we fail open so a flaky
 * judge never blocks the pipeline indefinitely).
 */
export function parseJudgeVerdict(stdout: string): JudgeVerdict | null {
  const json = extractJsonBlock(stdout);

  if (!json || typeof json !== 'object') {
    return null;
  }

  const obj = json as Record<string, unknown>;

  if (typeof obj.met !== 'boolean') {
    return null;
  }

  return {
    met: obj.met,
    critique: typeof obj.critique === 'string' ? obj.critique.trim() : '',
  };
}
