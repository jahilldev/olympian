import { extractJsonBlock } from '../agent/agent.utility.js';
import { JUDGE_MET_MARKER, JUDGE_UNMET_MARKER, type JudgeVerdict } from './judge.model.js';

/**
 * Reads the completion-judge verdict from a JUDGE run's stderr marker:
 * true (criteria met), false (not met), or null (no/unparseable verdict).
 */
export function judgeMetFromStderr(stderr: string | null | undefined): boolean | null {
  if (stderr?.includes(JUDGE_MET_MARKER)) {
    return true;
  }

  if (stderr?.includes(JUDGE_UNMET_MARKER)) {
    return false;
  }

  return null;
}

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
