export interface TestFailure {
  name: string;
  detail: string;
}

export interface TestResult {
  passed: boolean;
  summary: string;
  failures: TestFailure[];
}

export interface TestPromptContext {
  repoFullName: string;
  issueTitle: string;
  plan: string;
  hasBrowser: boolean;
  priorOutput?: string;
}
