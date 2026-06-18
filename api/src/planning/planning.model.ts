export const PLAN_REQUIRED_SECTIONS = [
  '## Summary',
  '## Approach',
  '## Files to change',
  '## Acceptance criteria',
  '## Risks',
] as const;

export interface PlanPromptContext {
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  priorPlan?: string;
  feedback?: string[];
  attachments?: string;
}
