export interface WorkspacePrepareInput {
  jobId: string;
  installationId: number;
  owner: string;
  repo: string;
  branchName: string;
  /** Defaults to the repo's default branch when omitted. */
  baseBranch?: string;
}

export interface Workspace {
  dir: string;
  branch: string;
  baseBranch: string;
}

export interface DiffSummary {
  changedFiles: string[];
  insertions: number;
  deletions: number;
  isDirty: boolean;
}
