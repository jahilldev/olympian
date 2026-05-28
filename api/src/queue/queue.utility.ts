/** Exponential backoff delay (ms) for a given attempt number (1-based). */
export function backoffMs(attempt: number, baseMs: number): number {
  const safeAttempt = Math.max(1, attempt);
  return baseMs * 2 ** (safeAttempt - 1);
}
