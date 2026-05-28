import { execSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { HermesAgentService } from '../src/agent/agent.service.js';
import { GithubApiService } from '../src/github-api/github-api.service.js';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { QueueService } from '../src/queue/queue.service.js';
import { OrchestratorService } from '../src/orchestrator/orchestrator.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AppConfigService } from '../src/config/config.service.js';

const SECRET = 'e2e-secret';
const DB_FILE = `test-e2e-${process.pid}.db`;

// Configure the environment before the app (and its ConfigModule validation) boots in
// beforeAll. The imports above don't read env at load time, so setting it here is fine.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = `file:./${DB_FILE}`;
process.env.GITHUB_APP_ID = '123';
process.env.GITHUB_WEBHOOK_SECRET = SECRET;
process.env.WORKER_ENABLED = 'false';

const REPO = {
  name: 'widgets',
  full_name: 'acme/widgets',
  owner: { login: 'acme', type: 'Organization' },
};
const INSTALLATION = { id: 12345 };

// ── Stubs ────────────────────────────────────────────────────────────────────
const comments: { target: number; body: string }[] = [];
const agentStub = {
  run: jest.fn(async (opts: { phase: string }) => {
    const stdout =
      opts.phase === 'REVIEW'
        ? '```json\n{"confidence":95,"verdict":"PASS","summary":"looks good","issues":[]}\n```'
        : opts.phase === 'PLAN'
          ? '## Summary\nAdd the feature.\n## Acceptance criteria\n- [ ] it works'
          : 'Done. Implemented the change.';
    return {
      runId: randomUUID(),
      status: 'SUCCEEDED',
      exitCode: 0,
      stdout,
      stderr: '',
      durationMs: 5,
    };
  }),
};
const githubStub = {
  createIssueComment: jest.fn(async (_ref: unknown, target: number, body: string) => {
    comments.push({ target, body });
    return comments.length;
  }),
  getCollaboratorPermission: jest.fn(async () => 'admin'),
  getDefaultBranch: jest.fn(async () => 'main'),
  createDraftPullRequest: jest.fn(async () => ({
    number: 1,
    url: 'https://github.com/acme/widgets/pull/1',
    headSha: 'deadbeef',
  })),
  getReviewFeedback: jest.fn(async () => []),
};
const workspaceStub = {
  prepare: jest.fn(async (input: { branchName: string }) => ({
    dir: '/tmp/job',
    branch: input.branchName,
    baseBranch: 'main',
  })),
  commitAll: jest.fn(async () => 'commitsha'),
  branchChangedFiles: jest.fn(async () => ['src/feature.ts']),
  hasCommitsAhead: jest.fn(async () => true),
  runVerify: jest.fn(async () => null),
  push: jest.fn(async () => 'pushsha'),
  cleanup: jest.fn(async () => undefined),
};

describe('Hermes orchestration pipeline (e2e)', () => {
  let app: INestApplication;
  let queue: InstanceType<typeof QueueService>;
  let orchestrator: InstanceType<typeof OrchestratorService>;
  let prisma: InstanceType<typeof PrismaService>;
  let webhookSecret: string;

  beforeAll(async () => {
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'ignore',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HermesAgentService)
      .useValue(agentStub)
      .overrideProvider(GithubApiService)
      .useValue(githubStub)
      .overrideProvider(WorkspaceService)
      .useValue(workspaceStub)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    queue = app.get(QueueService);
    orchestrator = app.get(OrchestratorService);
    prisma = app.get(PrismaService);
    // Sign with the secret the app actually resolved, independent of env precedence.
    webhookSecret = app.get(AppConfigService).get('GITHUB_WEBHOOK_SECRET');
  });

  afterAll(async () => {
    await app?.close();
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      rmSync(`prisma/${DB_FILE}${suffix}`, { force: true });
    }
  });

  const post = (event: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', webhookSecret).update(body, 'utf8').digest('hex')}`;
    return request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', event)
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', signature)
      .set('content-type', 'application/json')
      .send(body);
  };

  const drain = async () => {
    for (let i = 0; i < 30; i += 1) {
      const tasks = await queue.claimBatch('e2e', 5);
      if (tasks.length === 0) {
        return;
      }
      for (const task of tasks) {
        await orchestrator.processTask(task);
        await queue.complete(task.id);
      }
    }
  };

  const jobState = async () =>
    (
      await prisma.job.findUnique({
        where: { repoFullName_issueNumber: { repoFullName: 'acme/widgets', issueNumber: 1 } },
      })
    )?.state;

  it('rejects an unsigned webhook', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'issues')
      .set('x-github-delivery', randomUUID())
      .set('content-type', 'application/json')
      .send('{}')
      .expect(401);
  });

  it('creates a job and posts a plan when an issue is labeled', async () => {
    await post('issues', {
      action: 'labeled',
      label: { name: 'hermes' },
      issue: { number: 1, title: 'Add a feature', body: 'Please add the thing.' },
      repository: REPO,
      installation: INSTALLATION,
    }).expect(202);

    expect(await jobState()).toBe('TRIAGED');
    await drain();
    expect(await jobState()).toBe('AWAITING_PLAN_APPROVAL');
    expect(comments.some((c) => c.body.includes('implementation plan'))).toBe(true);
  });

  it('implements, self-reviews, and opens a draft PR after plan approval', async () => {
    await post('issue_comment', {
      action: 'created',
      comment: { id: 999, body: '/hermes approve', user: { login: 'maintainer', type: 'User' } },
      issue: { number: 1 },
      repository: REPO,
      installation: INSTALLATION,
    }).expect(202);

    await drain();

    expect(githubStub.createDraftPullRequest).toHaveBeenCalledTimes(1);
    expect(await jobState()).toBe('AWAITING_PR_APPROVAL');
    const review = await prisma.reviewPass.findFirst({});
    expect(review?.verdict).toBe('PASS');
  });

  it('completes the job when the PR is approved', async () => {
    await post('pull_request_review', {
      action: 'submitted',
      review: { state: 'approved', user: { login: 'maintainer', type: 'User' }, body: 'LGTM' },
      pull_request: { number: 1 },
      repository: REPO,
      installation: INSTALLATION,
    }).expect(202);

    expect(await jobState()).toBe('DONE');
  });
});
