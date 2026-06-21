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
  // so without this an unparseable failure silently falls open to "passed". The schema is fixed
  // (`passed` + `critique`), so we extract those fields directly and clean the critique up.
  const block = stdout.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? stdout;
  const passedMatch = block.match(/"passed"\s*:\s*(true|false)/i);

  if (!passedMatch) {
    return null;
  }

  return {
    passed: passedMatch[1].toLowerCase() === 'true',
    critique: extractCritique(block),
  };
}

/**
 * Pulls the `critique` value out of a (possibly malformed) JSON block. The critique is the last
 * field, so it runs from the opening quote to the final quote in the block; common JSON escapes
 * are un-escaped so the next agent receives clean prose rather than raw JSON.
 */
function extractCritique(block: string): string {
  const start = block.match(/"critique"\s*:\s*"/);

  if (!start) {
    return '';
  }

  const from = (start.index ?? 0) + start[0].length;
  const end = block.lastIndexOf('"');

  if (end <= from) {
    return '';
  }

  return block
    .slice(from, end)
    .replace(
      /\\(["\\/nt])/g,
      (_, c: string) => ({ '"': '"', '\\': '\\', '/': '/', n: '\n', t: '\t' })[c] ?? c,
    )
    .trim();
}
