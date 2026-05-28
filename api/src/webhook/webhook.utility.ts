import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the GitHub HMAC-SHA256 signature over the raw request body. The raw
 * body (not the re-serialized parsed object) must be used or the digest won't
 * match. Comparison is constant-time to avoid a timing side channel.
 */
export function verifySignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const received = Buffer.from(signatureHeader);
  const computed = Buffer.from(expected);
  return received.length === computed.length && timingSafeEqual(received, computed);
}

/** True for comments/reviews authored by a bot (including this app), to avoid loops. */
export function isBotUser(type: string): boolean {
  return type === 'Bot';
}

/** issue_comment fires for PRs too; this distinguishes a real issue from a PR thread. */
export function isPullRequestThread(issue: { pull_request?: unknown }): boolean {
  return issue.pull_request != null;
}
