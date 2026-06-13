export interface GithubUser {
  login: string;
  type: string; // "User" | "Bot" | "Organization"
}

export interface GithubRepo {
  name: string;
  full_name: string;
  owner: { login: string; type: string };
}

export interface GithubInstallationRef {
  id: number;
}

export interface IssuesPayload {
  action: string;
  label?: { name: string };
  issue: { number: number; title: string; body: string | null; pull_request?: unknown };
  repository: GithubRepo;
  installation?: GithubInstallationRef;
}

export interface IssueCommentPayload {
  action: string;
  comment: { id: number; body: string; user: GithubUser };
  issue: { number: number; pull_request?: unknown };
  repository: GithubRepo;
  installation?: GithubInstallationRef;
}

export interface PullRequestReviewPayload {
  action: string;
  review: { state: string; user: GithubUser; body: string | null };
  pull_request: { number: number };
  repository: GithubRepo;
  installation?: GithubInstallationRef;
}

export interface PullRequestReviewCommentPayload {
  action: string;
  comment: {
    id: number;
    body: string;
    user: GithubUser;
    path: string;
    line: number | null;
    original_line: number | null;
  };
  pull_request: { number: number };
  repository: GithubRepo;
  installation?: GithubInstallationRef;
}

export interface InstallationPayload {
  action: string;
  installation: { id: number; account: { login: string; type: string } };
}

export const SIGNATURE_HEADER = 'x-hub-signature-256';
export const EVENT_HEADER = 'x-github-event';
export const DELIVERY_HEADER = 'x-github-delivery';
