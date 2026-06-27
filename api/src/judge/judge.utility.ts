import { type JudgeVerdict } from './judge.model.js';

/**
 * Parses the judge's verdict. The definitive pass/fail signal is a tiny JSON block —
 * `{"passed": true|false}` — and the critique follows it as ordinary markdown, so the critique
 * never needs JSON escaping (code fences, quotes and lists are all fine). Returns null only when
 * no verdict can be found.
 */
export function parseJudgeVerdict(stdout: string): JudgeVerdict | null {
  // `passed` is a bare boolean in the JSON block; the block comes first, so the first match is it.
  const passedMatch = stdout.match(/"passed"\s*:\s*(true|false)/i);

  if (!passedMatch) {
    return null;
  }

  const passed = passedMatch[1].toLowerCase() === 'true';

  // Capture the critique regardless of pass/fail — on a fail it's the next pass's to-do list,
  // on a pass it's the judge's summary, kept for oversight.
  return { passed, critique: extractCritique(stdout) };
}

const HEADING_RE = /^[ \t]*(#{1,6})[ \t]+(.+?)[ \t]*#*$/;

/**
 * Re-bases the headings in the judge's freeform critique so the shallowest sits at `base` —
 * keeping the critique's own relative hierarchy but nesting it cleanly beneath the surrounding
 * prompt sections instead of colliding with them. Headings inside fenced code blocks are left
 * untouched. Mirrors the persist_state plugin's _relevel_headings so injected agent text behaves
 * consistently across the system. Returns the text unchanged when it has no headings.
 */
export function relevelCritique(text: string, base = 3): string {
  const lines = text.split('\n');

  const levels: number[] = [];
  let inFence = false;
  for (const line of lines) {
    const s = line.trimStart();
    if (s.startsWith('```') || s.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const m = HEADING_RE.exec(line);
    if (m) {
      levels.push(m[1].length);
    }
  }

  if (levels.length === 0) {
    return text;
  }

  const shift = base - Math.min(...levels);
  if (shift === 0) {
    return text;
  }

  inFence = false;
  return lines
    .map((line) => {
      const s = line.trimStart();
      if (s.startsWith('```') || s.startsWith('~~~')) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      const m = HEADING_RE.exec(line);
      if (!m) {
        return line;
      }
      const level = Math.max(1, Math.min(6, m[1].length + shift));
      return `${'#'.repeat(level)} ${m[2].trim()}`;
    })
    .join('\n');
}

/**
 * The critique is everything after the JSON verdict block. We strip the fenced ```json {...} ```
 * block (or a bare {...} object as a fallback) and an optional leading "Critique" heading,
 * leaving clean markdown to hand the next agent verbatim.
 */
function extractCritique(stdout: string): string {
  const fence = stdout.match(/```(?:json)?\s*\{[\s\S]*?\}\s*```/i);
  const bare = stdout.match(/\{[\s\S]*?"passed"[\s\S]*?\}/i);
  const block = fence ?? bare;

  const rest = block ? stdout.slice((block.index ?? 0) + block[0].length) : stdout;

  return rest.replace(/^\s*#{0,6}\s*critique\s*:?\s*/i, '').trim();
}
