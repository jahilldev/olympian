import { z } from 'zod';
import { extractJsonBlock } from '../agent/agent.utility.js';
import { type TestFailure, type TestResult } from './testing.model.js';

const testFailureSchema = z.object({
  name: z.string().default(''),
  detail: z.string().default(''),
});

const testResultSchema = z.object({
  passed: z.boolean(),
  summary: z.string().default(''),
  failures: z.array(testFailureSchema).default([]),
});

/**
 * Parses the test agent's stdout into a structured result. Returns null when the
 * agent did not emit a valid JSON verdict (caller treats that as a failing run).
 */
export function parseTestResult(stdout: string): TestResult | null {
  const raw = extractJsonBlock(stdout);
  const parsed = testResultSchema.safeParse(raw);
  if (!raw || !parsed.success) {
    return null;
  }
  return parsed.data;
}

/** Formats a parsed TestResult's failures as a human-readable string for the REVISE prompt. */
export function formatTestFailures(result: TestResult): string {
  const lines = [`Summary: ${result.summary}`];
  if (result.failures.length > 0) {
    lines.push('Failures:');
    result.failures.forEach((f: TestFailure, i: number) =>
      lines.push(`${i + 1}. ${f.name}\n   ${f.detail}`),
    );
  }
  return lines.join('\n');
}
