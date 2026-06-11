export const PLAN_REQUIRED_SECTIONS = [
  '## Summary',
  '## Approach',
  '## Files to change',
  '## Acceptance criteria',
  '## Risks',
] as const;

export interface IssueLabeledEvent {
  installationId: number;
  accountLogin: string;
  accountType: string;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  label: string;
}

export interface IssueCommentEvent {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  author: string;
  body: string;
  isBot: boolean;
}

export type PrReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface PrReviewEvent {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  state: PrReviewState;
  author: string;
  body: string;
  isBot: boolean;
}

export interface PrReviewCommentEvent {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  author: string;
  body: string;
  path: string;
  line: number | null;
  isBot: boolean;
}

export type CommandKind = 'approve' | 'revise' | 'cancel' | 'status' | 'retry' | 'none';

export interface Command {
  kind: CommandKind;
  text?: string;
}
