import { jest } from '@jest/globals';
import { OrchestratorService } from './orchestrator.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfigService } from '../config/config.service.js';
import type { JobService } from '../job/job.service.js';
import type { QueueService } from '../queue/queue.service.js';
import type { HermesAgentService } from '../agent/agent.service.js';
import type { WorkspaceService } from '../workspace/workspace.service.js';
import type { ReviewService } from '../review/review.service.js';
import type { VerifyService } from '../verify/verify.service.js';
import type { JudgeService } from '../judge/judge.service.js';
import type { GithubService } from '../github/github.service.js';

// `@jest/globals`' typed `jest.fn()` infers `never` returns; these helpers produce
// loosely-typed mocks whose `.mockResolvedValue`/`.mockReturnValue` accept any canned
// value. Args are captured (so tests can assert on call arguments).
const resolved = (value: unknown) => jest.fn((..._args: unknown[]) => Promise.resolve(value));
const returns = (value: unknown) => jest.fn((..._args: unknown[]) => value);

type Spy = { mock: { calls: unknown[][] } };

const enqueuedKinds = (queue: { enqueue: Spy }): string[] =>
  queue.enqueue.mock.calls.map((c) => (c[0] as { kind: string }).kind);

const transitionedTo = (jobs: { transition: Spy }): string[] =>
  jobs.transition.mock.calls.map((c) => c[1] as string);

// A job row as returned by prisma (includes `installation`). Overridable per test.
function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job1',
    state: 'VERIFYING',
    reviewCycle: 1,
    issueNumber: 5,
    issueTitle: 'Title',
    issueBody: 'Body',
    repoOwner: 'o',
    repoName: 'r',
    repoFullName: 'o/r',
    branchName: 'hermes/issue-5',
    prNumber: null,
    verifyCommand: 'npm test',
    installation: { installationId: 1n },
    ...overrides,
  };
}

const CONFIG: Record<string, unknown> = {
  BRANCH_PREFIX: 'hermes/issue-',
  COMMAND_PREFIX: '/hermes',
  MAX_VERIFY_ATTEMPTS: 3,
  MAX_COMPLETION_RETRIES: 2,
  HERMES_REVIEW_MODEL: '',
  HERMES_REVIEW_PROVIDER: '',
};

const PASS_REVIEW_JSON =
  '```json\n{"confidence":90,"verdict":"PASS","dimensions":{"correctness":true,"tests":true,"criteria":true,"security":true},"issues":[]}\n```';

const okRun = {
  runId: 'run1',
  status: 'SUCCEEDED',
  stdout: 'x'.repeat(300),
  stderr: '',
  exitCode: 0,
  durationMs: 10,
};

function setup(overrides: { job?: Record<string, unknown> } = {}) {
  const job = makeJob(overrides.job);

  const prisma = {
    jobRecords: { findUnique: resolved(job), findFirst: resolved(null), update: resolved(job) },
    planRevision: {
      findFirst: resolved({ content: 'the plan' }),
      updateMany: resolved(undefined),
      create: resolved(undefined),
    },
    planFeedback: { findMany: resolved([] as unknown[]), create: resolved(undefined) },
    pullRequestFeedback: {
      findMany: resolved([] as unknown[]),
      create: resolved(undefined),
      count: resolved(0),
    },
    reviewPass: {
      findMany: resolved([] as unknown[]),
      findFirst: resolved(null),
      count: resolved(0),
    },
    agentRun: { findFirst: resolved(null), count: resolved(0) },
    verifyRun: { findFirst: resolved(null) },
    queueTask: { findFirst: resolved({ kind: 'REVIEW' }) },
    pullRequest: {
      findUnique: resolved(null),
      create: resolved(undefined),
      updateMany: resolved(undefined),
    },
  };

  const config = { get: jest.fn((k: string) => CONFIG[k]) };

  const jobs = {
    findById: resolved(job),
    transition: resolved(job),
    update: resolved(job),
    incrementAttempts: resolved(1),
    createDashboard: resolved(job),
  };

  const queue = { enqueue: resolved(undefined), cancelForJob: resolved(undefined) };

  const agent = {
    run: resolved(okRun),
    markRunFailed: resolved(undefined),
    killContainerForJob: returns(undefined),
  };

  const workspace = {
    prepare: resolved({ dir: '/tmp/olympian-test-job1', branch: 'b', baseBranch: 'main' }),
    runVerify: resolved({ ok: true, output: '' }),
    commitAll: resolved('sha1'),
    branchChangedFiles: resolved([] as unknown[]),
    hasCommitsAhead: resolved(false),
    branchDiff: resolved('diff --git a/x b/x'),
    downloadAttachments: resolved([] as unknown[]),
    dir: returns('/tmp/olympian-test-job1'),
    push: resolved('sha1'),
    cleanup: resolved(undefined),
  };

  const review = {
    meetsThreshold: jest.fn((..._a: unknown[]) => true),
    persist: resolved(undefined),
    threshold: 85,
    maxPasses: 5,
  };

  const verify = {
    countForCycle: resolved(0),
    countFailedForCycle: resolved(1),
    record: resolved(undefined),
  };

  const judge = { assess: resolved({ passed: true, critique: '' }), listForJob: resolved([]) };

  const github = {
    createIssueComment: resolved(1),
    getDefaultBranch: resolved('main'),
    createIssueReaction: resolved(undefined),
    getCollaboratorPermission: resolved('admin'),
    createDraftPullRequest: resolved({ number: 67, url: 'https://gh/pr/67', headSha: 'sha-pr' }),
    updatePullRequest: resolved(undefined),
  };

  const service = new OrchestratorService(
    prisma as unknown as PrismaService,
    config as unknown as AppConfigService,
    jobs as unknown as JobService,
    queue as unknown as QueueService,
    agent as unknown as HermesAgentService,
    workspace as unknown as WorkspaceService,
    review as unknown as ReviewService,
    verify as unknown as VerifyService,
    judge as unknown as JudgeService,
    github as unknown as GithubService,
  );

  return {
    service,
    prisma,
    config,
    jobs,
    queue,
    agent,
    workspace,
    review,
    verify,
    judge,
    github,
    job,
  };
}

const callPrivate = (service: OrchestratorService, method: string, arg: string): Promise<void> =>
  (service as unknown as Record<string, (a: string) => Promise<void>>)[method](arg);

const spyPrivate = (service: OrchestratorService, method: string) =>
  jest
    .spyOn(service as unknown as Record<string, (a: string) => Promise<void>>, method)
    .mockResolvedValue(undefined);

describe('OrchestratorService.processTask', () => {
  it('skips a task whose job is in a terminal state', async () => {
    const { service, jobs } = setup({ job: { state: 'DONE' } });
    const handleVerify = spyPrivate(service, 'handleVerify');

    await service.processTask({ jobId: 'job1', kind: 'VERIFY' } as never);

    expect(jobs.findById).toHaveBeenCalled();
    expect(handleVerify).not.toHaveBeenCalled();
  });

  it('routes each kind to its handler', async () => {
    const { service } = setup({ job: { state: 'IMPLEMENTING' } });
    const handleVerify = spyPrivate(service, 'handleVerify');
    const handleRevise = spyPrivate(service, 'handleRevise');

    await service.processTask({ jobId: 'job1', kind: 'VERIFY' } as never);
    expect(handleVerify).toHaveBeenCalledWith('job1');

    await service.processTask({ jobId: 'job1', kind: 'REVISE' } as never);
    expect(handleRevise).toHaveBeenCalledWith('job1');
  });
});

describe('OrchestratorService.handleVerify', () => {
  it('passes → self-review then REVIEW', async () => {
    const { service, workspace, queue, jobs, verify } = setup();
    workspace.runVerify.mockResolvedValue({ ok: true, output: '' });

    await callPrivate(service, 'handleVerify', 'job1');

    expect(verify.record).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attempt: 1 }));
    expect(transitionedTo(jobs)).toContain('SELF_REVIEWING');
    expect(enqueuedKinds(queue)).toEqual(['REVIEW']);
  });

  it('fails under the cap → REVISE', async () => {
    const { service, workspace, queue, jobs } = setup();
    workspace.runVerify.mockResolvedValue({ ok: false, output: 'boom' });

    await callPrivate(service, 'handleVerify', 'job1');

    expect(transitionedTo(jobs)).toContain('REVISING');
    expect(enqueuedKinds(queue)).toEqual(['REVISE']);
  });

  it('fails at the cap → opens a draft PR', async () => {
    const { service, workspace, queue, jobs, verify, github } = setup();
    verify.countFailedForCycle.mockResolvedValue(3); // 3 failures === MAX_VERIFY_ATTEMPTS
    workspace.runVerify.mockResolvedValue({ ok: false, output: 'boom' });

    await callPrivate(service, 'handleVerify', 'job1');

    expect(transitionedTo(jobs)).toContain('OPENING_PR');
    expect(enqueuedKinds(queue)).toEqual(['OPEN_PR']);
    expect(github.createIssueComment).toHaveBeenCalled();
  });

  it('routes a FIRST verify failure to REVISE even after earlier passing verifies in the cycle', async () => {
    // The cap counts failures, not total verifies — two prior passes must not exhaust the budget.
    const { service, workspace, queue, jobs, verify } = setup();
    verify.countForCycle.mockResolvedValue(2); // 2 earlier (passing) verifies this cycle
    verify.countFailedForCycle.mockResolvedValue(1); // but only this one failed
    workspace.runVerify.mockResolvedValue({
      ok: false,
      output: 'npm ci EUSAGE: lockfile out of sync',
    });

    await callPrivate(service, 'handleVerify', 'job1');

    expect(transitionedTo(jobs)).toContain('REVISING');
    expect(enqueuedKinds(queue)).toEqual(['REVISE']);
  });

  it('retries once on failure before routing to REVISE', async () => {
    const { service, workspace, queue } = setup();
    workspace.runVerify
      .mockResolvedValueOnce({ ok: false, output: 'flake' })
      .mockResolvedValueOnce({ ok: true, output: '' });

    await callPrivate(service, 'handleVerify', 'job1');

    expect(workspace.runVerify).toHaveBeenCalledTimes(2);
    expect(enqueuedKinds(queue)).toEqual(['REVIEW']); // recovered → review, not revise
  });

  it('skips to REVIEW when no verify command is available', async () => {
    const { service, workspace, queue, jobs, verify } = setup({ job: { verifyCommand: '' } });

    await callPrivate(service, 'handleVerify', 'job1');

    expect(workspace.runVerify).not.toHaveBeenCalled();
    expect(verify.record).not.toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('SELF_REVIEWING');
    expect(enqueuedKinds(queue)).toEqual(['REVIEW']);
  });
});

describe('OrchestratorService.handleImplement', () => {
  it('single pass → increments cycle, then verifies', async () => {
    const { service, queue, jobs, workspace } = setup({ job: { state: 'IMPLEMENTING' } });

    await callPrivate(service, 'handleImplement', 'job1');

    expect(workspace.commitAll).toHaveBeenCalled();
    expect(jobs.update).toHaveBeenCalledWith('job1', { reviewCycle: { increment: 1 } });
    expect(transitionedTo(jobs)).toContain('VERIFYING');
    expect(enqueuedKinds(queue)).toEqual(['VERIFY']);
  });

  it('marks the run FAILED and throws when nothing was committed', async () => {
    const { service, agent, workspace, queue } = setup({ job: { state: 'IMPLEMENTING' } });
    workspace.commitAll.mockResolvedValue(null);

    await expect(callPrivate(service, 'handleImplement', 'job1')).rejects.toThrow(
      /no file changes/,
    );
    expect(agent.markRunFailed).toHaveBeenCalledWith(
      'run1',
      expect.stringContaining('no file changes'),
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('re-runs the agent with the judge critique when the pass is judged incomplete', async () => {
    const { service, agent, judge, queue } = setup({ job: { state: 'IMPLEMENTING' } });
    judge.assess.mockResolvedValueOnce({
      passed: false,
      critique: 'finish the aimLaunchDot cleanup',
    });

    await callPrivate(service, 'handleImplement', 'job1');

    // Initial pass + one judge-driven continuation, then proceed to VERIFY.
    expect(agent.run.mock.calls.length).toBe(2);
    const secondPrompt = (agent.run.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain('finish the aimLaunchDot cleanup');
    expect(enqueuedKinds(queue)).toEqual(['VERIFY']);
  });

  it('judges every pass, including the final over-budget one, before proceeding', async () => {
    const { service, agent, judge, queue } = setup({ job: { state: 'IMPLEMENTING' } });
    // Judge never passes → the loop runs until the retry budget is exhausted.
    judge.assess.mockResolvedValue({ passed: false, critique: 'still incomplete' });

    await callPrivate(service, 'handleImplement', 'job1');

    // MAX_COMPLETION_RETRIES=2 → 3 passes (initial + 2 retries). The final, over-budget pass is
    // still judged (oversight), then ships to VERIFY regardless of the verdict.
    expect(agent.run.mock.calls.length).toBe(3);
    expect(judge.assess).toHaveBeenCalledTimes(3);
    expect(enqueuedKinds(queue)).toEqual(['VERIFY']);
  });
});

describe('OrchestratorService.handleRevise', () => {
  it('feeds BOTH prior review issues and the failed verify into the prompt, then re-verifies', async () => {
    const { service, prisma, agent, queue, jobs } = setup({ job: { state: 'REVISING' } });
    prisma.reviewPass.findMany.mockResolvedValue([
      { issues: JSON.stringify([{ severity: 'high', title: 'NPE risk', detail: 'guard it' }]) },
    ]);
    prisma.verifyRun.findFirst.mockResolvedValue({
      ok: false,
      command: 'npm test',
      output: 'BUILD-BROKEN',
    });

    await callPrivate(service, 'handleRevise', 'job1');

    const prompt = (agent.run.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain('NPE risk'); // review feedback present
    expect(prompt).toContain('BUILD-BROKEN'); // verify failure present
    expect(transitionedTo(jobs)).toContain('VERIFYING');
    expect(enqueuedKinds(queue)).toEqual(['VERIFY']);
  });

  it('marks the run FAILED and throws when the revision changed nothing', async () => {
    const { service, agent, workspace, queue } = setup({ job: { state: 'REVISING' } });
    workspace.commitAll.mockResolvedValue(null);

    await expect(callPrivate(service, 'handleRevise', 'job1')).rejects.toThrow(/no file changes/);
    expect(agent.markRunFailed).toHaveBeenCalledWith(
      'run1',
      expect.stringContaining('no file changes'),
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('proceeds (no throw) when a pass makes no changes but the branch already has commits', async () => {
    // Resume-after-restart case: the prior pass committed the work, so a re-run that finds nothing
    // to do must NOT be failed — it advances to VERIFY (the real gate) instead.
    const { service, agent, workspace, queue, jobs } = setup({ job: { state: 'REVISING' } });
    workspace.commitAll.mockResolvedValue(null);
    workspace.hasCommitsAhead.mockResolvedValue(true);

    await callPrivate(service, 'handleRevise', 'job1');

    expect(agent.markRunFailed).not.toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('VERIFYING');
    expect(enqueuedKinds(queue)).toEqual(['VERIFY']);
  });
});

describe('OrchestratorService.handleReview', () => {
  it('gate met → opens a PR', async () => {
    const { service, agent, review, queue, jobs } = setup({ job: { state: 'SELF_REVIEWING' } });
    agent.run.mockResolvedValue({ ...okRun, stdout: PASS_REVIEW_JSON });
    review.meetsThreshold.mockReturnValue(true);

    await callPrivate(service, 'handleReview', 'job1');

    expect(review.persist).toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('OPENING_PR');
    expect(enqueuedKinds(queue)).toEqual(['OPEN_PR']);
  });

  it('gate not met (under cap) → REVISE', async () => {
    const { service, agent, review, queue, jobs } = setup({ job: { state: 'SELF_REVIEWING' } });
    agent.run.mockResolvedValue({ ...okRun, stdout: PASS_REVIEW_JSON });
    review.meetsThreshold.mockReturnValue(false);

    await callPrivate(service, 'handleReview', 'job1');

    expect(transitionedTo(jobs)).toContain('REVISING');
    expect(enqueuedKinds(queue)).toEqual(['REVISE']);
  });

  it('marks the run FAILED when it produces no parseable verdict, then re-reviews', async () => {
    const { service, agent, review, queue } = setup({ job: { state: 'SELF_REVIEWING' } });
    agent.run.mockResolvedValue({ ...okRun, stdout: 'no json verdict here' });
    review.meetsThreshold.mockReturnValue(false);

    await callPrivate(service, 'handleReview', 'job1');

    expect(agent.markRunFailed).toHaveBeenCalledWith('run1', expect.stringContaining('parseable'));
    expect(enqueuedKinds(queue)).toEqual(['REVIEW']); // unparseable → retry the review
  });
});

describe('OrchestratorService.cancelJob', () => {
  it('cancels an active job: stops tasks, kills the container, marks CANCELLED', async () => {
    const { service, queue, agent, jobs } = setup({ job: { state: 'IMPLEMENTING' } });

    await service.cancelJob('job1', '@alice');

    expect(queue.cancelForJob).toHaveBeenCalledWith('job1');
    expect(agent.killContainerForJob).toHaveBeenCalledWith('job1');
    expect(transitionedTo(jobs)).toContain('CANCELLED');
  });

  it('is a no-op for a job already in a terminal state', async () => {
    const { service, queue, jobs } = setup({ job: { state: 'DONE' } });

    await service.cancelJob('job1', '@alice');

    expect(queue.cancelForJob).not.toHaveBeenCalled();
    expect(jobs.transition).not.toHaveBeenCalled();
  });
});

describe('OrchestratorService.approvePlan', () => {
  it('approves the plan: marks it APPROVED, moves to IMPLEMENTING, enqueues IMPLEMENT', async () => {
    const { service, prisma, queue, jobs } = setup({ job: { state: 'AWAITING_PLAN_APPROVAL' } });

    const result = await service.approvePlan('job1', 'the dashboard');

    expect(result).toEqual({ approved: true });
    expect(prisma.planRevision.updateMany).toHaveBeenCalledWith({
      where: { jobId: 'job1', status: 'PROPOSED' },
      data: { status: 'APPROVED' },
    });
    expect(transitionedTo(jobs)).toContain('IMPLEMENTING');
    expect(enqueuedKinds(queue)).toEqual(['IMPLEMENT']);
  });

  it('refuses to approve when the job is not awaiting plan approval', async () => {
    const { service, queue, jobs } = setup({ job: { state: 'IMPLEMENTING' } });

    const result = await service.approvePlan('job1', 'the dashboard');

    expect(result.approved).toBe(false);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(jobs.transition).not.toHaveBeenCalled();
  });
});

describe('OrchestratorService.handleOpenPr', () => {
  it('loops back to REVISE when PR feedback arrived after the last work pass', async () => {
    const { service, prisma, queue, jobs } = setup({ job: { state: 'OPENING_PR' } });
    prisma.agentRun.findFirst.mockResolvedValue({ createdAt: new Date(0) });
    prisma.pullRequestFeedback.count.mockResolvedValue(1);

    await callPrivate(service, 'handleOpenPr', 'job1');

    expect(transitionedTo(jobs)).toContain('REVISING');
    expect(enqueuedKinds(queue)).toEqual(['REVISE']);
  });

  it('opens a draft PR with a generated body when none exists yet', async () => {
    const { service, prisma, github, jobs } = setup({
      job: { state: 'OPENING_PR', prNumber: null },
    });
    prisma.agentRun.findFirst.mockResolvedValue({ createdAt: new Date(0) });
    prisma.pullRequestFeedback.count.mockResolvedValue(0);

    await callPrivate(service, 'handleOpenPr', 'job1');

    expect(github.createDraftPullRequest).toHaveBeenCalled();
    expect(github.updatePullRequest).not.toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('AWAITING_PR_APPROVAL');
  });

  it('refreshes the existing PR body (not just headSha) after addressing changes', async () => {
    const { service, prisma, github } = setup({ job: { state: 'OPENING_PR', prNumber: 67 } });
    prisma.agentRun.findFirst.mockResolvedValue({ createdAt: new Date(0) });
    prisma.pullRequestFeedback.count.mockResolvedValue(0);

    await callPrivate(service, 'handleOpenPr', 'job1');

    expect(github.updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      67,
      expect.objectContaining({ body: expect.any(String) }),
    );
    expect(github.createDraftPullRequest).not.toHaveBeenCalled();
  });
});

describe('OrchestratorService.onPullRequestReview (changes requested)', () => {
  const prEvent = {
    owner: 'acme',
    repo: 'widgets',
    prNumber: 7,
    state: 'changes_requested' as const,
    author: 'alice',
    body: 'please fix the edge case',
    isBot: false,
  };

  it('records feedback and restarts the cycle when the PR is awaiting approval', async () => {
    const { service, prisma, queue, jobs } = setup({ job: { state: 'AWAITING_PR_APPROVAL' } });
    prisma.jobRecords.findFirst.mockResolvedValue(makeJob({ state: 'AWAITING_PR_APPROVAL' }));

    await service.onPullRequestReview(prEvent as never);

    expect(prisma.pullRequestFeedback.create).toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('IMPLEMENTING');
    expect(enqueuedKinds(queue)).toEqual(['IMPLEMENT']);
  });

  it('records feedback but does NOT restart when the job is already working mid-cycle', async () => {
    const { service, prisma, queue, jobs } = setup({ job: { state: 'IMPLEMENTING' } });
    prisma.jobRecords.findFirst.mockResolvedValue(makeJob({ state: 'IMPLEMENTING' }));

    await service.onPullRequestReview(prEvent as never);

    expect(prisma.pullRequestFeedback.create).toHaveBeenCalled(); // not lost
    expect(jobs.transition).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('OrchestratorService.onPrReviewComment', () => {
  it('records an inline review comment even when the job is mid-cycle', async () => {
    const { service, prisma } = setup({ job: { state: 'IMPLEMENTING' } });
    prisma.jobRecords.findFirst.mockResolvedValue(makeJob({ state: 'IMPLEMENTING' }));

    await service.onPrReviewComment({
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      author: 'alice',
      body: 'tweak this line',
      path: 'src/x.ts',
      line: 12,
      isBot: false,
    } as never);

    expect(prisma.pullRequestFeedback.create).toHaveBeenCalled();
  });
});

describe('OrchestratorService.retryJob', () => {
  it('re-runs a FAILED job from its last phase', async () => {
    const { service, prisma, queue, jobs } = setup({ job: { state: 'FAILED' } });
    prisma.queueTask.findFirst.mockResolvedValue({ kind: 'IMPLEMENT' });

    const result = await service.retryJob('job1', '@alice');

    expect(result).toEqual({ retried: true, kind: 'IMPLEMENT' });
    expect(jobs.update).toHaveBeenCalledWith('job1', { error: null });
    expect(transitionedTo(jobs)).toContain('IMPLEMENTING');
    expect(enqueuedKinds(queue)).toEqual(['IMPLEMENT']);
  });

  it('refuses to retry a job that is not FAILED', async () => {
    const { service, queue, jobs } = setup({ job: { state: 'IMPLEMENTING' } });

    const result = await service.retryJob('job1', '@alice');

    expect(result.retried).toBe(false);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(jobs.transition).not.toHaveBeenCalled();
  });
});

describe('OrchestratorService dashboard actions', () => {
  it('createDashboardJob creates a job and enqueues PLAN', async () => {
    const { service, jobs, queue } = setup();

    const res = await service.createDashboardJob({ title: 't', requirements: 'r' });

    expect(jobs.createDashboard).toHaveBeenCalled();
    expect(res).toEqual({ id: 'job1' });
    expect(enqueuedKinds(queue)).toEqual(['PLAN']);
  });

  it('submitPlanFeedback supersedes the plan and re-plans when awaiting approval', async () => {
    const { service, prisma, jobs, queue } = setup({ job: { state: 'AWAITING_PLAN_APPROVAL' } });

    const res = await service.submitPlanFeedback('job1', 'dashboard', 'change X');

    expect(res.ok).toBe(true);
    expect(prisma.planFeedback.create).toHaveBeenCalled();
    expect(prisma.planRevision.updateMany).toHaveBeenCalledWith({
      where: { jobId: 'job1', status: 'PROPOSED' },
      data: { status: 'SUPERSEDED' },
    });
    expect(transitionedTo(jobs)).toContain('PLANNING');
    expect(enqueuedKinds(queue)).toEqual(['PLAN']);
  });

  it('submitPlanFeedback refuses when the job is not awaiting plan approval', async () => {
    const { service, queue, jobs } = setup({ job: { state: 'IMPLEMENTING' } });

    const res = await service.submitPlanFeedback('job1', 'dashboard', 'x');

    expect(res.ok).toBe(false);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(jobs.transition).not.toHaveBeenCalled();
  });

  it('acceptResult transitions to DONE and cleans up the workspace', async () => {
    const { service, jobs, workspace } = setup({ job: { state: 'AWAITING_PR_APPROVAL' } });

    const res = await service.acceptResult('job1', 'the dashboard');

    expect(res.ok).toBe(true);
    expect(transitionedTo(jobs)).toContain('DONE');
    expect(workspace.cleanup).toHaveBeenCalledWith('job1');
  });

  it('acceptResult refuses when not awaiting result approval', async () => {
    const { service, jobs } = setup({ job: { state: 'IMPLEMENTING' } });

    expect((await service.acceptResult('job1', 'x')).ok).toBe(false);
    expect(jobs.transition).not.toHaveBeenCalled();
  });

  it('requestChanges records feedback and restarts IMPLEMENT', async () => {
    const { service, prisma, jobs, queue } = setup({ job: { state: 'AWAITING_PR_APPROVAL' } });

    const res = await service.requestChanges('job1', 'dashboard', 'fix Y');

    expect(res.ok).toBe(true);
    expect(prisma.pullRequestFeedback.create).toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('IMPLEMENTING');
    expect(enqueuedKinds(queue)).toEqual(['IMPLEMENT']);
  });

  it('setRepo updates the repo and discards the workspace while editable', async () => {
    const { service, jobs, workspace } = setup({
      job: { origin: 'DASHBOARD', state: 'AWAITING_PLAN_APPROVAL' },
    });

    const res = await service.setRepo('job1', 'git@github.com:o/r.git');

    expect(res.ok).toBe(true);
    expect(jobs.update).toHaveBeenCalledWith('job1', { repoUrl: 'git@github.com:o/r.git' });
    expect(workspace.cleanup).toHaveBeenCalledWith('job1');
  });

  it('setRepo refuses once past plan approval', async () => {
    const { service } = setup({ job: { origin: 'DASHBOARD', state: 'IMPLEMENTING' } });

    expect((await service.setRepo('job1', 'git@h:o/r.git')).ok).toBe(false);
  });

  it('setRepo refuses on GitHub-origin jobs', async () => {
    const { service } = setup({ job: { origin: 'GITHUB', state: 'TRIAGED' } });

    expect((await service.setRepo('job1', 'git@h:o/r.git')).ok).toBe(false);
  });

  it('diff returns the branch diff', async () => {
    const { service, workspace } = setup({ job: { origin: 'DASHBOARD' } });

    const res = await service.diff('job1');

    expect(workspace.branchDiff).toHaveBeenCalled();
    expect(res).toEqual({ diff: 'diff --git a/x b/x' });
  });
});

describe('OrchestratorService workspace auth', () => {
  it('authenticates GitHub jobs with the installation BigInt id, not the job FK', async () => {
    const { service, workspace } = setup({
      job: {
        state: 'VERIFYING',
        installationId: 'cmq_fk_cuid',
        installation: { installationId: 42n },
      },
    });

    await callPrivate(service, 'handleVerify', 'job1');

    const { auth } = workspace.prepare.mock.calls[0][0] as {
      auth: { kind: string; installationId: number; owner: string; repo: string };
    };
    expect(auth).toEqual({ kind: 'github-app', installationId: 42, owner: 'o', repo: 'r' });
  });

  it('uses an SSH remote for a dashboard job with a repoUrl', async () => {
    const { service, workspace } = setup({
      job: { state: 'VERIFYING', origin: 'DASHBOARD', repoUrl: 'git@github.com:o/r.git' },
    });

    await callPrivate(service, 'handleVerify', 'job1');

    const { auth } = workspace.prepare.mock.calls[0][0] as { auth: { kind: string; url?: string } };
    expect(auth).toEqual({ kind: 'ssh', url: 'git@github.com:o/r.git' });
  });
});

describe('OrchestratorService.handlePlan (dashboard origin)', () => {
  it('skips the GitHub issue comment and posts a plan revision', async () => {
    const { service, prisma, github, jobs } = setup({
      job: {
        origin: 'DASHBOARD',
        issueNumber: null,
        installation: null,
        installationId: null,
        repoOwner: null,
        repoName: null,
        repoFullName: null,
        repoUrl: null,
        state: 'PLANNING',
        branchName: null,
      },
    });

    await callPrivate(service, 'handlePlan', 'job1');

    expect(github.createIssueComment).not.toHaveBeenCalled();
    expect(prisma.planRevision.create).toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('AWAITING_PLAN_APPROVAL');
  });
});

describe('OrchestratorService.handleOpenPr (dashboard origin)', () => {
  it('pushes the branch and awaits result approval without opening a PR', async () => {
    const { service, workspace, jobs, github } = setup({
      job: {
        origin: 'DASHBOARD',
        repoUrl: 'git@github.com:o/r.git',
        state: 'OPENING_PR',
        prNumber: null,
      },
    });

    await callPrivate(service, 'handleOpenPr', 'job1');

    expect(workspace.push).toHaveBeenCalled();
    expect(github.getDefaultBranch).not.toHaveBeenCalled();
    expect(transitionedTo(jobs)).toContain('AWAITING_PR_APPROVAL');
  });
});
