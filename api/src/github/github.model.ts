export interface RepoRef {
  installationId: number;
  owner: string;
  repo: string;
}

export type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

/** Permissions that authorize a human to approve/iterate on a job. */
export const APPROVAL_PERMISSIONS: ReadonlySet<RepoPermission> = new Set([
  'admin',
  'maintain',
  'write',
]);

export interface DraftPrInput {
  title: string;
  head: string;
  base: string;
  body: string;
}

export interface CreatedPr {
  number: number;
  url: string;
  headSha: string;
}

export interface PullRequestInfo {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  isDraft: boolean;
  headSha: string;
  url: string;
}

export interface ReviewFeedback {
  author: string;
  body: string;
  path?: string;
  line?: number;
}

export interface AttachmentRef {
  url: string;
  filename: string;
}
