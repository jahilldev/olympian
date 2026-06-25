export const METRIC_PREFIX = 'hermes_';

export type AgentPhaseLabel =
  | 'PLAN'
  | 'IMPLEMENT'
  | 'REVIEW'
  | 'REVISE'
  | 'SUMMARY'
  | 'VERIFY'
  | 'JUDGE'
  | 'CHAT';
export type AgentRunStatusLabel = 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
