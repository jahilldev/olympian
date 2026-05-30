import { resolve } from 'node:path';

/** Absolute, per-job workspace directory under the configured root. */
export function workspaceDir(root: string, jobId: string): string {
  return resolve(root, jobId);
}

/** SSH remote URL — authentication is handled by the host machine's SSH credentials. */
export function sshRemoteUrl(owner: string, repo: string): string {
  return `git@github.com:${owner}/${repo}.git`;
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
