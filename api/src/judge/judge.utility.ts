import { extractJsonBlock } from '../agent/agent.utility.js';
import { type JudgeVerdict } from './judge.model.js';

/**
 * Parses the judge's verdict from its stdout. Returns null only when no verdict at all can be
 * found (caller decides how to treat that).
 */
export function parseJudgeVerdict(stdout: string): JudgeVerdict | null {
  // Preferred path: a well-formed JSON block.
  const json = extractJsonBlock(stdout);

  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;

    if (typeof obj.passed === 'boolean') {
      return {
        passed: obj.passed,
        critique: typeof obj.critique === 'string' ? obj.critique.trim() : '',
      };
    }
  }

  // Fallback: the judge frequently emits a valid `passed` boolean but a multi-line `critique`
  // string with unescaped newlines/quotes that breaks strict JSON.parse. Recovering the verdict
  // here is critical — a "not passed" run carries a long critique (most likely to break JSON),
  // so without this an unparseable failure silently falls open to "passed".
  const match = stdout.match(/"passed"\s*:\s*(true|false)/i);

  if (match) {
    const passed = match[1].toLowerCase() === 'true';

    // Hand the next pass the judge's full output as the critique — it holds the detail.
    return { passed, critique: passed ? '' : stdout.trim() };
  }

  return null;
}
