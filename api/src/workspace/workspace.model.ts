/**
 * How a workspace authenticates to its remote:
 *  - `github-app`: HTTPS clone/push with a short-lived installation token (GitHub jobs).
 *  - `ssh`: clone/push the given SSH remote with the configured deploy key (dashboard jobs).
 *  - `none`: no remote — a scratch `git init` workspace (greenfield dashboard jobs).
 */
export type RemoteAuth =
  | { kind: 'github-app'; installationId: number; owner: string; repo: string }
  | { kind: 'ssh'; url: string }
  | { kind: 'none' };

export interface WorkspacePrepareInput {
  jobId: string;
  auth: RemoteAuth;
  branchName: string;
  /** Defaults to the repo's default branch when omitted. */
  baseBranch?: string;
}

export interface Workspace {
  dir: string;
  branch: string;
  baseBranch: string;
}

/** Base branch created for a scratch (`none`-auth) workspace, so the job branch has a diff base. */
export const SCRATCH_BASE_BRANCH = 'main';

export interface DiffSummary {
  changedFiles: string[];
  insertions: number;
  deletions: number;
  isDirty: boolean;
}

export interface DownloadedAttachment {
  filename: string;
  relativePath: string;
}
