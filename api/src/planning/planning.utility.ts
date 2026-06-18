import { PLAN_REQUIRED_SECTIONS } from './planning.model.js';

export function missingPlanSections(content: string): string[] {
  const lower = content.toLowerCase();

  return PLAN_REQUIRED_SECTIONS.filter((s) => !lower.includes(s.toLowerCase()));
}

/** Best-effort extraction of the "Acceptance criteria" section from a plan. */
export function acceptanceCriteria(plan: string): string | undefined {
  const match = plan.match(/##\s*Acceptance criteria\s*\n([\s\S]*?)(?:\n##\s|\s*$)/i);

  return match ? match[1].trim() : undefined;
}

/**
 * Extracts the file paths the plan declares in its "Files to change" section.
 * Looks for backticked tokens that look like paths (contain a slash or a file
 * extension). Used for plan-grounding and scope checks. Returns unique paths.
 */
export function planFilePaths(plan: string): string[] {
  const match = plan.match(/##\s*Files to change\s*\n([\s\S]*?)(?:\n##\s|\s*$)/i);
  const section = match ? match[1] : '';
  const paths = new Set<string>();

  for (const m of section.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim().replace(/[)\].,;:]+$/, '');

    if (token.includes('/') || /\.[a-z0-9]+$/i.test(token)) {
      paths.add(token);
    }
  }

  return [...paths];
}

/** Renders the GitHub issue comment that posts a plan revision for human approval. */
export function renderPlanComment(
  plan: string,
  commandPrefix: string,
  groundingWarnings: string[] = [],
): string {
  const lines = [`### Hermes implementation plan`, ``, plan, ``, `---`];

  if (groundingWarnings.length > 0) {
    lines.push(
      `> ⚠️ **Plan grounding:** these referenced paths were not found in the repo — confirm they're intended as new files rather than hallucinated edit targets:`,
      ...groundingWarnings.map((p) => `> - \`${p}\``),
      ``,
    );
  }

  lines.push(
    `Reply with **\`${commandPrefix} approve\`** to start implementation, or leave a comment with corrections to iterate. (\`${commandPrefix} cancel\` to stop, \`${commandPrefix} status\` to check progress.)`,
  );

  return lines.join('\n');
}
