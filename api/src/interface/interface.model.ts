import type { AgentPhase } from '../agent/agent.model.js';
import type { TaskKind, TaskStatus } from '../queue/queue.model.js';
import type { ReviewVerdict, IssueSeverity } from '../review/review.model.js';

export interface ActiveRunDto {
  id: string;
  phase: AgentPhase;
  model: string | null;
  createdAt: string;
}

export interface ActiveTaskDto {
  kind: TaskKind;
  status: TaskStatus;
  attempts: number;
}

export interface JobSummaryDto {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  state: string;
  confidence: number | null;
  reviewCycle: number;
  prNumber: number | null;
  prUrl: string | null;
  prIsDraft: boolean;
  createdAt: string;
  updatedAt: string;
  activeRun: ActiveRunDto | null;
  activeTask: ActiveTaskDto | null;
}

export interface TransitionDto {
  id: string;
  fromState: string | null;
  toState: string;
  reason: string | null;
  actor: string;
  createdAt: string;
}

export interface PlanRevisionDto {
  id: string;
  revision: number;
  content: string;
  status: string;
  createdAt: string;
}

export interface FeedbackDto {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewIssueDto {
  severity: IssueSeverity;
  title: string;
  detail: string;
  file?: string;
}

export interface ReviewPassDto {
  id: string;
  cycle: number;
  passNumber: number;
  confidence: number;
  verdict: ReviewVerdict;
  issues: ReviewIssueDto[];
  createdAt: string;
}

export interface AgentRunDto {
  id: string;
  phase: AgentPhase;
  model: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  hasOutput: boolean;
  createdAt: string;
}

export interface JobDetailDto extends JobSummaryDto {
  issueBody: string;
  branchName: string | null;
  headSha: string | null;
  error: string | null;
  transitions: TransitionDto[];
  plans: PlanRevisionDto[];
  planFeedback: FeedbackDto[];
  prFeedback: FeedbackDto[];
  reviewPasses: ReviewPassDto[];
  runs: AgentRunDto[];
}
