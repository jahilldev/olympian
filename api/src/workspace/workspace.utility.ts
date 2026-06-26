import { resolve } from 'node:path';

/** Absolute, per-job workspace directory under the configured root. */
export function workspaceDir(root: string, jobId: string): string {
  return resolve(root, jobId);
}

/** HTTPS remote URL carrying a short-lived installation token. */
export function authenticatedRemoteUrl(owner: string, repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/**
 * The `core.sshCommand` for SSH clone/push when a dedicated deploy key is configured:
 * use that key (and only that key) so the orchestrator isn't reliant on whatever the host
 * agent happens to hold. `StrictHostKeyChecking=accept-new` trusts a first-contact host and
 * records it in the persistent known_hosts rather than blocking on an interactive prompt.
 * When no key is configured the caller skips this entirely and lets git use the host's SSH.
 */
export function sshGitCommand(keyPath: string): string {
  return `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
}

/** Files touched in the working tree, from a simple-git StatusResult. */
export function changedFilesFromStatus(status: {
  created: string[];
  modified: string[];
  deleted: string[];
  not_added: string[];
  renamed: { to: string }[];
}): string[] {
  const set = new Set<string>([
    ...status.created,
    ...status.modified,
    ...status.deleted,
    ...status.not_added,
    ...status.renamed.map((r) => r.to),
  ]);
  return [...set];
}
