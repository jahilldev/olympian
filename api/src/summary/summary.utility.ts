import { type PrBodyInput } from './summary.model.js';

function verifyLabel(verifyOk: boolean | null): string {
  if (verifyOk === null) {
    return 'not run';
  }
  return verifyOk ? 'passing' : 'failing';
}

export function buildPrBody(input: PrBodyInput): string {
  const lines = [input.agentSummary.trim(), '', `Closes #${input.issueNumber}`, '', '---'];

  if (input.meetsThreshold) {
    lines.push(
      `🤖 Automated review passed — all rubric checks green (tests: ${verifyLabel(input.verifyOk)}; advisory confidence ${input.confidence ?? 'n/a'}/100).`,
    );
  } else {
    const failed =
      input.failedDimensions.length > 0
        ? ` failing checks: ${input.failedDimensions.join(', ')};`
        : '';

    lines.push(
      `🤖 Automated review did NOT pass —${failed} tests: ${verifyLabel(input.verifyOk)} (advisory confidence ${input.confidence ?? 'n/a'}/100). Opened as a draft for human attention.`,
    );

    if (input.unresolvedIssues) {
      lines.push('', '**Unresolved findings:**', '', input.unresolvedIssues);
    }
  }
  return lines.join('\n');
}
