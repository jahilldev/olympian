import { rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { type JobRecords, type QueueTask, type RepoInstallation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { JobService } from '../job/job.service.js';
import { branchNameFor } from '../job/job.utility.js';
import { type CreateDashboardJobInput, type JobState, TERMINAL_STATES } from '../job/job.model.js';
import { QueueService } from '../queue/queue.service.js';
import { type TaskKind } from '../queue/queue.model.js';
import { type RemoteAuth } from '../workspace/workspace.model.js';
import { HermesAgentService } from '../agent/agent.service.js';
import { incompleteOutputReason } from '../agent/agent.utility.js';
import { buildPlanPrompt } from '../planning/planning.prompts.js';
import {
  missingPlanSections,
  planFilePaths,
  renderPlanComment,
} from '../planning/planning.utility.js';
import { buildImplementPrompt } from '../implement/implement.prompts.js';
import { implementCommitMessage } from '../implement/implement.utility.js';
import { buildRevisePrompt } from '../revise/revise.prompts.js';
import { reviseCommitMessage } from '../revise/revise.utility.js';
import { buildVerifyPrompt } from '../verify/verify.prompts.js';
import { parseVerifyCommand } from '../verify/verify.utility.js';
import { VerifyService } from '../verify/verify.service.js';
import { JudgeService } from '../judge/judge.service.js';
import { relevelCritique } from '../judge/judge.utility.js';
import { buildSummaryPrompt } from '../summary/summary.prompts.js';
import { buildPrBody } from '../summary/summary.utility.js';
import { WorkspaceService } from '../workspace/workspace.service.js';
import { ReviewService } from '../review/review.service.js';
import { buildReviewPrompt } from '../review/review.prompts.js';
import { type ReviewIssue, type ReviewResult } from '../review/review.model.js';
import {
  failedDimensions,
  formatIssues,
  formatIssuesMarkdown,
  outOfPlanChanges,
  parseReview,
  reviewResultFromRecord,
} from '../review/review.utility.js';
import { GithubService } from '../github/github.service.js';
import { APPROVAL_PERMISSIONS, type RepoRef, type ReviewFeedback } from '../github/github.model.js';
import { extractAttachmentUrls } from '../github/github.utility.js';
import {
  type IssueCommentEvent,
  type IssueLabeledEvent,
  type PrReviewCommentEvent,
  type PrReviewEvent,
} from './orchestrator.model.js';
import {
  buildStatusReport,
  formatDownloadedAttachments,
  parseCommand,
} from './orchestrator.utility.js';

/**
 * The dark-factory brain. Two surfaces:
 *  - event handlers (called by the webhook module) advance a job's state and
 *    enqueue the next stage;
 *  - processTask (called by the worker) executes a stage, with the implement and
 *    review/revise loops running internally so guidance passes in-memory.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly jobs: JobService,
    private readonly queue: QueueService,
    private readonly agent: HermesAgentService,
    private readonly workspace: WorkspaceService,
    private readonly review: ReviewService,
    private readonly verify: VerifyService,
    private readonly judge: JudgeService,
    private readonly github: GithubService,
  ) {}

  // ── Webhook-driven events ──────────────────────────────────────────────────

  async onIssueLabeled(evt: IssueLabeledEvent): Promise<void> {
    const installation = await this.upsertInstallation(evt);
    const triggerLabel = installation.triggerLabel ?? this.config.get('TRIGGER_LABEL');

    if (evt.label !== triggerLabel) {
      return;
    }

    const ref: RepoRef = {
      installationId: Number(installation.installationId),
      owner: evt.owner,
      repo: evt.repo,
    };

    await this.safeReaction(ref, evt.issueNumber, 'eyes');

    const repoFullName = `${evt.owner}/${evt.repo}`;
    const existing = await this.jobs.findByRepoIssue(repoFullName, evt.issueNumber);

    if (existing) {
      const state = existing.state as JobState;

      if (!TERMINAL_STATES.has(state) || state === 'DONE') {
        this.logger.debug(
          `Job already exists for ${repoFullName}#${evt.issueNumber} in state ${state}; ignoring label`,
        );

        return;
      }

      // FAILED or CANCELLED: restart from scratch.
      await this.jobs.update(existing.id, { error: null });
      await this.jobs.transition(existing.id, 'PLANNING', { reason: 're-labeled', actor: 'HUMAN' });
      await this.queue.enqueue({ jobId: existing.id, kind: 'PLAN' });

      await this.safeComment(
        ref,
        evt.issueNumber,
        `Hermes is restarting this issue and will draft a fresh implementation plan.`,
      );

      return;
    }

    const job = await this.jobs.create({
      installationId: installation.id,
      repoOwner: evt.owner,
      repoName: evt.repo,
      issueNumber: evt.issueNumber,
      issueTitle: evt.issueTitle,
      issueBody: evt.issueBody,
      triggerLabel,
    });

    await this.queue.enqueue({ jobId: job.id, kind: 'PLAN' });

    await this.safeComment(
      ref,
      evt.issueNumber,
      `Hermes picked up this issue and is drafting an implementation plan. I'll post it here for your approval.`,
    );
  }

  async onIssueComment(evt: IssueCommentEvent): Promise<void> {
    if (evt.isBot) {
      return;
    }

    const repoFullName = `${evt.owner}/${evt.repo}`;

    // For comments on a PR thread, evt.issueNumber is the PR number — not the original
    // issue number — so fall back to a prNumber lookup when the issue lookup misses.
    const job =
      (await this.jobs.findByRepoIssue(repoFullName, evt.issueNumber)) ??
      (await this.prisma.jobRecords.findFirst({
        where: { repoFullName, prNumber: evt.issueNumber },
      }));

    if (!job) {
      return;
    }

    const { ref } = await this.context(job.id);

    if (!ref) {
      return;
    }

    const command = parseCommand(evt.body, this.config.get('COMMAND_PREFIX'));

    if (command.kind === 'status') {
      const [activeRun, reviewPassCount, activeTask, prRef, lastReviewPass] = await Promise.all([
        this.prisma.agentRun.findFirst({
          where: { jobId: job.id, status: 'RUNNING' },
          orderBy: { createdAt: 'desc' },
          select: { phase: true, createdAt: true },
        }),
        this.prisma.reviewPass.count({ where: { jobId: job.id, cycle: job.reviewCycle } }),
        this.prisma.queueTask.findFirst({
          where: { jobId: job.id, status: { in: ['PENDING', 'RUNNING'] } },
          orderBy: { createdAt: 'desc' },
          select: { attempts: true, maxAttempts: true, lastError: true },
        }),
        this.prisma.pullRequest.findUnique({
          where: { jobId: job.id },
          select: { prNumber: true },
        }),
        this.prisma.reviewPass.findFirst({
          where: { jobId: job.id, cycle: job.reviewCycle },
          orderBy: { passNumber: 'desc' },
          select: { issues: true, verifyOk: true, dimensions: true },
        }),
      ]);

      const lastResult = lastReviewPass
        ? reviewResultFromRecord({
            confidence: job.confidence ?? 0,
            verdict: 'FAIL',
            dimensions: lastReviewPass.dimensions,
            verifyOk: lastReviewPass.verifyOk,
            issues: lastReviewPass.issues,
          })
        : null;

      const lastIssues: ReviewIssue[] = lastResult?.issues ?? [];

      await this.safeComment(
        ref,
        evt.issueNumber,
        buildStatusReport({
          state: job.state,
          confidence: job.confidence,
          error: job.error,
          prNumber: prRef?.prNumber ?? null,
          activeRunPhase: activeRun?.phase ?? null,
          activeRunStartedAt: activeRun?.createdAt ?? null,
          reviewPassCount,
          activeTask,
          commandPrefix: this.config.get('COMMAND_PREFIX'),
          lastReviewIssues: lastIssues.length > 0 ? formatIssuesMarkdown(lastIssues) : undefined,
          lastReviewIssueCount: lastIssues.length > 0 ? lastIssues.length : undefined,
          verifyOk: lastResult?.verifyOk ?? null,
          failedChecks: lastResult ? failedDimensions(lastResult.dimensions) : [],
        }),
      );

      await this.safeCommentReaction(ref, evt.commentId, 'eyes');

      return;
    }

    if (command.kind === 'approve' || command.kind === 'cancel' || command.kind === 'revise') {
      if (!(await this.isAuthorized(ref, evt.author))) {
        await this.safeComment(
          ref,
          evt.issueNumber,
          `@${evt.author} you need write access to this repo to control Hermes.`,
        );

        return;
      }
    }

    if (command.kind === 'cancel') {
      await this.cancelJob(job.id, `@${evt.author}`);
      await this.safeCommentReaction(ref, evt.commentId, 'eyes');

      return;
    }

    if (command.kind === 'retry') {
      const result = await this.retryJob(job.id, `@${evt.author}`);

      if (!result.retried) {
        await this.safeComment(
          ref,
          evt.issueNumber,
          `Nothing to retry — job is currently in **${job.state}** state.`,
        );
      }

      await this.safeCommentReaction(ref, evt.commentId, 'eyes');

      return;
    }

    // /hermes revise on a PR thread: store feedback and enqueue IMPLEMENT only when
    // the job is parked (AWAITING_PR_APPROVAL). If an agent is already running the
    // feedback is persisted and will be picked up on the next handleImplement call.
    if (command.kind === 'revise' && job.prNumber) {
      const prefix = this.config.get('COMMAND_PREFIX');

      const strippedBody = evt.body
        .split('\n')
        .filter((l) => !l.trim().toLowerCase().startsWith(prefix.toLowerCase()))
        .join('\n')
        .trim();

      const feedbackBody = command.text
        ? `${command.text}${strippedBody ? `\n\n${strippedBody}` : ''}`
        : strippedBody || evt.body;

      await this.prisma.pullRequestFeedback.create({
        data: { jobId: job.id, author: evt.author, body: feedbackBody },
      });

      await this.safeCommentReaction(ref, evt.commentId, 'eyes');

      if (job.state === 'AWAITING_PR_APPROVAL') {
        await this.jobs.transition(job.id, 'IMPLEMENTING', {
          reason: `revision requested by @${evt.author}`,
          actor: 'HUMAN',
        });

        await this.queue.enqueue({ jobId: job.id, kind: 'IMPLEMENT' });

        await this.safeComment(
          ref,
          evt.issueNumber,
          `On it — I'll address the feedback and push an update.`,
        );
      } else {
        await this.safeComment(
          ref,
          evt.issueNumber,
          `Feedback noted — I'll incorporate it into the current run.`,
        );
      }

      return;
    }

    // Plan controls only apply while awaiting plan approval.
    if (job.state !== 'AWAITING_PLAN_APPROVAL') {
      return;
    }

    if (command.kind === 'approve') {
      await this.approvePlan(job.id, `@${evt.author}`);
      await this.safeCommentReaction(ref, evt.commentId, 'eyes');

      return;
    }

    // Anything else from a human while awaiting approval is iteration feedback.
    const revisionCount = await this.prisma.planRevision.count({ where: { jobId: job.id } });

    if (revisionCount >= this.config.get('MAX_PLAN_REVISIONS')) {
      await this.jobs.fail(job.id, 'Plan revision limit reached without approval');

      await this.safeComment(
        ref,
        evt.issueNumber,
        `Reached the plan revision limit (${this.config.get('MAX_PLAN_REVISIONS')}). Stopping. Re-label to restart.`,
      );

      return;
    }

    await this.safeCommentReaction(ref, evt.commentId, 'eyes');

    await this.submitPlanFeedback(job.id, evt.author, evt.body, { githubCommentId: evt.commentId });
  }

  async onPullRequestReview(evt: PrReviewEvent): Promise<void> {
    if (evt.isBot) {
      return;
    }

    const repoFullName = `${evt.owner}/${evt.repo}`;

    const job = await this.prisma.jobRecords.findFirst({
      where: { repoFullName, prNumber: evt.prNumber },
    });

    // Act on any live job for this PR — not only one parked at AWAITING_PR_APPROVAL, so a
    // second round of requested changes mid-cycle is still recorded and acknowledged.
    if (!job || TERMINAL_STATES.has(job.state as JobState)) {
      return;
    }

    const { ref } = await this.context(job.id);

    if (!ref) {
      return;
    }

    if (!(await this.isAuthorized(ref, evt.author))) {
      return;
    }

    if (evt.state === 'approved') {
      // Approval only completes a job that's actually waiting on the PR.
      if (job.state !== 'AWAITING_PR_APPROVAL') {
        return;
      }

      await this.prisma.pullRequest.updateMany({
        where: { jobId: job.id },
        data: { state: 'open' },
      });

      await this.jobs.transition(job.id, 'DONE', {
        reason: `PR approved by @${evt.author}`,
        actor: 'HUMAN',
      });

      await this.safeComment(ref, evt.prNumber, `Approved — Hermes is done here. 🎉`);
      await this.safeReaction(ref, evt.prNumber, 'eyes');
      await this.workspace.cleanup(job.id).catch(() => undefined);

      return;
    }

    if (evt.state === 'changes_requested' || evt.state === 'commented') {
      // Always record the feedback so it's never lost, even mid-cycle. The implement/revise
      // stages pick up PR feedback created since the last implement run.
      await this.prisma.pullRequestFeedback.create({
        data: { jobId: job.id, author: evt.author, body: evt.body },
      });

      if (job.state === 'AWAITING_PR_APPROVAL') {
        // The PR was settled — start a fresh revision cycle to address the feedback.
        await this.jobs.transition(job.id, 'IMPLEMENTING', {
          reason: `changes requested by @${evt.author}`,
          actor: 'HUMAN',
        });

        await this.queue.enqueue({ jobId: job.id, kind: 'IMPLEMENT' });

        await this.safeComment(
          ref,
          evt.prNumber,
          `On it — addressing the requested changes and I'll push an update.`,
        );
      } else {
        // Already working — the new feedback folds into the in-flight cycle's next revision.
        await this.safeComment(
          ref,
          evt.prNumber,
          `Noted — I'll fold this into the changes already in progress.`,
        );
      }

      await this.safeReaction(ref, evt.prNumber, 'eyes');
    }
  }

  // ── Queue task processing ──────────────────────────────────────────────────

  async onPrReviewComment(evt: PrReviewCommentEvent): Promise<void> {
    if (evt.isBot) {
      return;
    }

    const repoFullName = `${evt.owner}/${evt.repo}`;

    const job = await this.prisma.jobRecords.findFirst({
      where: { repoFullName, prNumber: evt.prNumber },
    });

    // Record inline comments on any live job — not only one parked at AWAITING_PR_APPROVAL — so
    // a comment left while the agent is mid-cycle isn't lost. The recorded feedback is folded
    // into the next REVISE/IMPLEMENT pass, and the OPEN_PR gate won't present the PR until it's
    // been through a work pass.
    if (!job || TERMINAL_STATES.has(job.state as JobState)) {
      return;
    }

    const { ref } = await this.context(job.id);

    if (!ref) {
      return;
    }

    if (!(await this.isAuthorized(ref, evt.author))) {
      return;
    }

    await this.prisma.pullRequestFeedback.create({
      data: { jobId: job.id, author: evt.author, body: evt.body, path: evt.path, line: evt.line },
    });
  }

  async processTask(task: QueueTask): Promise<void> {
    const job = await this.jobs.findById(task.jobId);

    if (!job || TERMINAL_STATES.has(job.state as JobState)) {
      this.logger.warn(
        `Skipping ${task.kind} task ${task.id}: job ${task.jobId} is ${job?.state ?? 'missing'}`,
      );

      return;
    }

    const kind = task.kind as TaskKind;

    switch (kind) {
      case 'PLAN':
        return this.handlePlan(task.jobId);
      case 'IMPLEMENT':
        return this.handleImplement(task.jobId);
      case 'VERIFY':
        return this.handleVerify(task.jobId);
      case 'REVIEW':
        return this.handleReview(task.jobId);
      case 'OPEN_PR':
        return this.handleOpenPr(task.jobId);
      case 'REVISE':
        return this.handleRevise(task.jobId);
    }
  }

  /** Called by the worker when a task exhausts its retries. */
  async onTaskExhausted(jobId: string, error: string): Promise<void> {
    const job = await this.jobs.findById(jobId);

    if (!job) {
      return;
    }

    await this.queue.cancelForJob(jobId);
    await this.jobs.fail(jobId, error);

    try {
      const { ref } = await this.context(jobId);
      const target = job.prNumber ?? job.issueNumber;

      await this.safeComment(
        ref,
        target,
        `Hermes hit an unrecoverable error and stopped:\n\n> ${error.slice(0, 500)}`,
      );
    } catch {
      // best-effort notification
    }
  }

  // ── Operator actions (shared by the /hermes commands and the dashboard) ──────

  /**
   * Cancel an in-flight job: stop outstanding tasks, kill any running container, and
   * mark it CANCELLED. No-op if the job is already in a terminal state. `by` is a
   * display string for the audit trail (e.g. `@user` or `the dashboard`).
   */
  async cancelJob(jobId: string, by: string): Promise<void> {
    const job = await this.jobs.findById(jobId);

    if (!job || TERMINAL_STATES.has(job.state as JobState)) {
      return;
    }

    await this.queue.cancelForJob(jobId);
    this.agent.killContainerForJob(jobId);
    await this.jobs.transition(jobId, 'CANCELLED', {
      reason: `cancelled by ${by}`,
      actor: 'HUMAN',
    });

    try {
      const { ref } = await this.context(jobId);
      await this.safeComment(
        ref,
        job.prNumber ?? job.issueNumber,
        `Cancelled. Re-label the issue to start over.`,
      );
    } catch {
      // best-effort notification
    }
  }

  /**
   * Approve the proposed plan: mark it APPROVED, move to IMPLEMENTING, and start the
   * implement loop. Returns `{ approved: false }` (with a reason) when the job isn't
   * awaiting plan approval, so callers can surface that instead of acting. `by` is a
   * display string for the audit trail (e.g. `@user` or `the dashboard`).
   */
  async approvePlan(jobId: string, by: string): Promise<{ approved: boolean; reason?: string }> {
    const job = await this.jobs.findById(jobId);

    if (!job) {
      return { approved: false, reason: 'job not found' };
    }

    if (job.state !== 'AWAITING_PLAN_APPROVAL') {
      return { approved: false, reason: `job is ${job.state}, not awaiting plan approval` };
    }

    await this.prisma.planRevision.updateMany({
      where: { jobId, status: 'PROPOSED' },
      data: { status: 'APPROVED' },
    });

    await this.jobs.transition(jobId, 'IMPLEMENTING', {
      reason: `plan approved by ${by}`,
      actor: 'HUMAN',
    });

    await this.queue.enqueue({ jobId, kind: 'IMPLEMENT' });

    try {
      const { ref } = await this.context(jobId);
      await this.safeComment(
        ref,
        job.issueNumber,
        `Plan approved — implementing now. I'll open a draft PR when it's ready.`,
      );
    } catch {
      // best-effort notification
    }

    return { approved: true };
  }

  /** Create a dashboard-origin job and start planning. Returns the new job id. */
  async createDashboardJob(input: CreateDashboardJobInput): Promise<{ id: string }> {
    const job = await this.jobs.createDashboard(input);

    await this.queue.enqueue({ jobId: job.id, kind: 'PLAN' });

    return { id: job.id };
  }

  /**
   * Record plan-iteration feedback, supersede the proposed plan, and re-plan. Mirrors the
   * `/hermes <feedback>` webhook branch; called by both it and the dashboard endpoint. `by`
   * is recorded as the feedback author. Returns `{ ok: false }` when the job isn't awaiting
   * plan approval.
   */
  async submitPlanFeedback(
    jobId: string,
    by: string,
    body: string,
    opts: { githubCommentId?: number } = {},
  ): Promise<{ ok: boolean; reason?: string }> {
    const job = await this.jobs.findById(jobId);

    if (!job) {
      return { ok: false, reason: 'job not found' };
    }

    if (job.state !== 'AWAITING_PLAN_APPROVAL') {
      return { ok: false, reason: `job is ${job.state}, not awaiting plan approval` };
    }

    await this.prisma.planFeedback.create({
      data: {
        jobId,
        author: by,
        body,
        githubCommentId: opts.githubCommentId !== undefined ? BigInt(opts.githubCommentId) : null,
      },
    });

    await this.prisma.planRevision.updateMany({
      where: { jobId, status: 'PROPOSED' },
      data: { status: 'SUPERSEDED' },
    });

    await this.jobs.transition(jobId, 'PLANNING', {
      reason: `plan feedback from ${by}`,
      actor: 'HUMAN',
    });

    await this.queue.enqueue({ jobId, kind: 'PLAN' });

    return { ok: true };
  }

  /**
   * Accept a dashboard job's delivered result → DONE (the dashboard analogue of a PR
   * approval). Only valid while awaiting result approval.
   */
  async acceptResult(jobId: string, by: string): Promise<{ ok: boolean; reason?: string }> {
    const job = await this.jobs.findById(jobId);

    if (!job) {
      return { ok: false, reason: 'job not found' };
    }

    if (job.state !== 'AWAITING_PR_APPROVAL') {
      return { ok: false, reason: `job is ${job.state}, not awaiting result approval` };
    }

    await this.jobs.transition(jobId, 'DONE', { reason: `accepted by ${by}`, actor: 'HUMAN' });
    await this.workspace.cleanup(jobId).catch(() => undefined);

    return { ok: true };
  }

  /**
   * Request changes on a dashboard job's delivered result → start a fresh revision cycle
   * (the dashboard analogue of `changes_requested`). The note is stored as PR feedback so
   * the existing revise loop picks it up. Only valid while awaiting result approval.
   */
  async requestChanges(
    jobId: string,
    by: string,
    body: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const job = await this.jobs.findById(jobId);

    if (!job) {
      return { ok: false, reason: 'job not found' };
    }

    if (job.state !== 'AWAITING_PR_APPROVAL') {
      return { ok: false, reason: `job is ${job.state}, not awaiting result approval` };
    }

    await this.prisma.pullRequestFeedback.create({ data: { jobId, author: by, body } });

    await this.jobs.transition(jobId, 'IMPLEMENTING', {
      reason: `changes requested by ${by}`,
      actor: 'HUMAN',
    });

    await this.queue.enqueue({ jobId, kind: 'IMPLEMENT' });

    return { ok: true };
  }

  /**
   * Set or replace a dashboard job's working repo. v1 only allows this up to plan approval
   * (before any code is committed); past that, the committed work lives in the old clone and
   * retargeting would need a "materialise onto a fresh repo" step (Phase 2). The existing
   * workspace is discarded so the next `prepare` clones the new remote (or inits a scratch tree).
   */
  async setRepo(jobId: string, repoUrl: string | null): Promise<{ ok: boolean; reason?: string }> {
    const job = await this.jobs.findById(jobId);

    if (!job) {
      return { ok: false, reason: 'job not found' };
    }

    if (job.origin !== 'DASHBOARD') {
      return { ok: false, reason: 'the repo can only be set on dashboard jobs' };
    }

    const editable: JobState[] = ['TRIAGED', 'PLANNING', 'AWAITING_PLAN_APPROVAL'];

    if (!editable.includes(job.state as JobState)) {
      return {
        ok: false,
        reason: `the repo can't be changed once past plan approval (job is ${job.state}); cancel and recreate to retarget`,
      };
    }

    await this.jobs.update(jobId, { repoUrl });
    await this.workspace.cleanup(jobId).catch(() => undefined);

    return { ok: true };
  }

  /** Unified diff of the job branch vs its base — the dashboard's no-PR result view. */
  async diff(jobId: string): Promise<{ diff: string }> {
    const { job, installation } = await this.context(jobId);

    const ws = await this.workspace.prepare({
      jobId,
      auth: this.remoteAuthFor(job, installation),
      branchName: this.branchFor(job),
    });

    return { diff: await this.workspace.branchDiff(ws.dir, ws.baseBranch) };
  }

  /**
   * Re-run a FAILED job from the phase it died in. Returns `{ retried: false }` (with a
   * reason) when the job isn't FAILED, so callers can surface that instead of acting.
   */
  async retryJob(
    jobId: string,
    by: string,
  ): Promise<{ retried: boolean; kind?: TaskKind; reason?: string }> {
    const job = await this.jobs.findById(jobId);

    if (!job) {
      return { retried: false, reason: 'job not found' };
    }

    if (job.state !== 'FAILED') {
      return { retried: false, reason: `job is ${job.state}, not FAILED` };
    }

    const lastTask = await this.prisma.queueTask.findFirst({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
      select: { kind: true },
    });

    const retryKind = (lastTask?.kind ?? 'REVIEW') as TaskKind;

    const retryStateMap: Record<TaskKind, JobState> = {
      PLAN: 'PLANNING',
      IMPLEMENT: 'IMPLEMENTING',
      VERIFY: 'VERIFYING',
      REVIEW: 'SELF_REVIEWING',
      REVISE: 'REVISING',
      OPEN_PR: 'OPENING_PR',
    };

    await this.jobs.update(jobId, { error: null });
    await this.jobs.transition(jobId, retryStateMap[retryKind], {
      reason: `retried by ${by}`,
      actor: 'HUMAN',
      force: true,
    });
    await this.queue.enqueue({ jobId, kind: retryKind });

    try {
      const { ref } = await this.context(jobId);
      await this.safeComment(
        ref,
        job.prNumber ?? job.issueNumber,
        `Retrying from the **${retryKind}** phase.`,
      );
    } catch {
      // best-effort notification
    }

    return { retried: true, kind: retryKind };
  }

  // ── Stage handlers ─────────────────────────────────────────────────────────

  private async handlePlan(jobId: string): Promise<void> {
    const { job, installation, ref } = await this.context(jobId);

    await this.jobs.transition(jobId, 'PLANNING', { reason: 'drafting plan', actor: 'AGENT' });

    const branchName = this.branchFor(job);

    const ws = await this.workspace.prepare({
      jobId,
      auth: this.remoteAuthFor(job, installation),
      branchName,
    });

    if (!job.branchName) {
      await this.jobs.update(jobId, { branchName });
    }

    const lastRevision = await this.prisma.planRevision.findFirst({
      where: { jobId },
      orderBy: { revision: 'desc' },
    });

    const feedback = lastRevision
      ? await this.prisma.planFeedback.findMany({
          where: { jobId, createdAt: { gt: lastRevision.createdAt } },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // Attachments are GitHub-hosted and need an installation token to fetch — skip for
    // dashboard jobs, which have neither an installation nor a GitHub issue to attach to.
    const downloaded =
      ref && job.installationId
        ? await this.workspace.downloadAttachments(
            ws.dir,
            Number(job.installationId),
            extractAttachmentUrls([job.issueBody, ...feedback.map((f) => f.body)].join('\n')),
          )
        : [];

    const prompt = buildPlanPrompt({
      repoFullName: this.repoLabel(job),
      issueNumber: job.issueNumber ?? 0,
      issueTitle: job.issueTitle,
      issueBody: job.issueBody,
      priorPlan: lastRevision?.content,
      feedback: feedback.map((f) => f.body),
      attachments: formatDownloadedAttachments(downloaded),
    });

    const res = await this.agent.run({
      jobId,
      phase: 'PLAN',
      cwd: ws.dir,
      prompt,
      // A plan is incomplete if it's too short or missing required sections — either
      // marks the run FAILED rather than recording a phantom success.
      validate: (stdout) => {
        const tooShort = incompleteOutputReason(stdout, 500);
        if (tooShort) {
          return tooShort;
        }
        const missing = missingPlanSections(stdout);
        return missing.length > 0 ? `missing required sections: ${missing.join(', ')}` : null;
      },
    });

    if (res.status !== 'SUCCEEDED') {
      throw new Error(`planning failed (${res.status}); ${res.stderr.slice(0, 300)}`);
    }

    const nextRevision = (lastRevision?.revision ?? 0) + 1;
    const planContent = res.stdout.trim();

    // Plan grounding: flag paths the plan references that don't exist in the repo.
    // Only surface when the plan also touches real files (a pure greenfield plan
    // legitimately references files that don't exist yet), so the warning points
    // at likely-hallucinated edit targets rather than expected new files.
    const referencedPaths = planFilePaths(planContent);
    const missingPaths = referencedPaths.filter((p) => !existsSync(join(ws.dir, p)));
    const someExist = referencedPaths.some((p) => existsSync(join(ws.dir, p)));
    const groundingWarnings = someExist ? missingPaths : [];

    // GitHub jobs surface the plan as an issue comment; dashboard jobs surface it in the UI
    // (which reads PlanRevision directly), so there's no comment to post.
    let githubCommentId: bigint | null = null;

    if (ref && job.issueNumber !== null) {
      const commentBody = renderPlanComment(
        planContent,
        this.config.get('COMMAND_PREFIX'),
        groundingWarnings,
      );

      githubCommentId = BigInt(
        await this.github.createIssueComment(ref, job.issueNumber, commentBody),
      );
    }

    await this.prisma.planRevision.create({
      data: {
        jobId,
        revision: nextRevision,
        content: planContent,
        status: 'PROPOSED',
        githubCommentId,
      },
    });

    await this.jobs.transition(jobId, 'AWAITING_PLAN_APPROVAL', {
      reason: `plan revision ${nextRevision} posted`,
      actor: 'AGENT',
    });
  }

  private async handleImplement(jobId: string): Promise<void> {
    const { job, installation } = await this.context(jobId);

    if (job.state !== 'IMPLEMENTING') {
      await this.jobs.transition(jobId, 'IMPLEMENTING', {
        reason: 're-implementing',
        actor: 'AGENT',
      });
    }

    const branchName = this.branchFor(job);
    const auth = this.remoteAuthFor(job, installation);

    const ws = await this.workspace.prepare({ jobId, auth, branchName });

    if (!job.branchName) {
      await this.jobs.update(jobId, { branchName });
    }

    const plan = await this.approvedPlan(jobId);
    let guidance: string | undefined;

    const reviewBodies: string[] = [];

    // PR/result feedback applies once a PR exists (GitHub) or for any dashboard job, where
    // "request changes" stores feedback without a PR number. Older GitHub jobs with no PR
    // yet have nothing to fold in.
    if (job.prNumber || job.origin === 'DASHBOARD') {
      const prRevisions = await this.prisma.pullRequestFeedback.findMany({
        where: { jobId },
        orderBy: { createdAt: 'asc' },
      });

      if (prRevisions.length > 0) {
        const formatted = this.formatPrFeedback(
          prRevisions.map((r) => ({
            author: r.author,
            body: r.body,
            path: r.path ?? undefined,
            line: r.line ?? undefined,
          })),
        );

        guidance = formatted;
        reviewBodies.push(...prRevisions.map((r) => r.body));
      }
    }

    // Attachments need an installation token (GitHub-only); dashboard jobs skip the download.
    const downloaded =
      installation && job.installationId
        ? await this.workspace.downloadAttachments(
            ws.dir,
            Number(job.installationId),
            extractAttachmentUrls([job.issueBody, ...reviewBodies].join('\n')),
          )
        : [];
    const attachments = formatDownloadedAttachments(downloaded);

    // Implementation pass(es) under the completion-judge loop. Tests/build are NOT run
    // here — that's the dedicated VERIFY stage; any failure (verify or review) routes to REVISE.
    await this.runWithCompletionLoop({
      job,
      auth,
      phase: 'IMPLEMENT',
      ws,
      goal: plan,
      buildPrompt: (attempt, critique, progress) =>
        buildImplementPrompt({
          jobId,
          repoFullName: this.repoLabel(job),
          issueTitle: job.issueTitle,
          issueBody: job.issueBody,
          plan,
          attempt,
          // On a continuation the judge's critique IS the to-do list; otherwise any PR-feedback guidance.
          guidance: critique ?? guidance,
          attachments,
          progress,
        }),
      commitMessage: (attempt) =>
        implementCommitMessage(job.issueNumber ?? 0, job.issueTitle, attempt),
      noChangesError: 'implementation produced no file changes',
    });

    await this.jobs.incrementAttempts(jobId);
    await this.jobs.update(jobId, { reviewCycle: { increment: 1 } });

    await this.jobs.transition(jobId, 'VERIFYING', {
      reason: 'implementation complete',
      actor: 'AGENT',
    });

    await this.queue.enqueue({ jobId, kind: 'VERIFY' });
  }

  /**
   * Runs an IMPLEMENT/REVISE pass under the completion-judge loop — Hermes' `/goal` pattern,
   * orchestrated here. After each agent run we commit + push (each attempt is an inspectable
   * checkpoint), then a judge decides whether the goal (acceptance criteria / issues to fix) is
   * actually met. If not, the agent is re-invoked in the SAME workspace with the judge's critique
   * as its to-do list — so it resumes targeting the gaps instead of re-orienting — up to
   * MAX_COMPLETION_RETRIES, after which we proceed to VERIFY regardless (the deterministic gate
   * still applies). MAX_COMPLETION_RETRIES=0 disables the loop (single pass, no judge).
   */
  /** The agent's durable working-memory file, injected into each pass so a resume never depends on
   * the model choosing to read it. Returns undefined when absent/empty (a fresh unit of work). */
  private async readWorkingMemory(dir: string): Promise<string | undefined> {
    try {
      const content = (await readFile(join(dir, '.olympian', 'PROGRESS.md'), 'utf8')).trim();

      return content || undefined;
    } catch {
      return undefined;
    }
  }

  private async runWithCompletionLoop(p: {
    job: JobRecords;
    auth: RemoteAuth;
    phase: 'IMPLEMENT' | 'REVISE';
    ws: { dir: string; branch: string; baseBranch: string };
    goal: string;
    /** Original plan supplied to the judge as background context (REVISE), when the goal isn't the plan. */
    context?: string;
    buildPrompt: (
      attempt: number,
      critique: string | undefined,
      progress: string | undefined,
    ) => string;
    commitMessage: (attempt: number) => string;
    noChangesError: string;
  }): Promise<void> {
    const maxRetries = this.config.get('MAX_COMPLETION_RETRIES');
    let critique: string | undefined;

    for (let attempt = 1; ; attempt++) {
      // Inject the durable working-memory file into every pass so a resume never depends on the
      // model remembering to read it (it's re-read each attempt, picking up the prior pass's state).
      const progress = await this.readWorkingMemory(p.ws.dir);

      const res = await this.agent.run({
        jobId: p.job.id,
        phase: p.phase,
        cwd: p.ws.dir,
        prompt: p.buildPrompt(attempt, critique, progress),
        validate: (stdout) => incompleteOutputReason(stdout, 200),
      });

      if (res.status !== 'SUCCEEDED') {
        throw new Error(
          `${p.phase.toLowerCase()} agent ${res.status}; ${res.stderr.slice(0, 300)}`,
        );
      }

      const sha = await this.workspace.commitAll(p.ws.dir, p.commitMessage(attempt));

      if (sha === null) {
        if (attempt === 1) {
          // A clean exit that edited nothing is not a success, however long its output.
          await this.agent.markRunFailed(res.runId, p.noChangesError);

          throw new Error(p.noChangesError);
        }

        // A continuation that changed nothing — the agent considers itself done. Accept and proceed.
        this.logger.log(
          `[job ${p.job.id}] ${p.phase} continuation ${attempt} made no further changes; proceeding`,
        );

        break;
      }

      await this.pushBranch(p.job, p.auth, p.ws.branch);

      // Judge disabled entirely — proceed; VERIFY/REVIEW are the backstop.
      if (maxRetries <= 0) {
        break;
      }

      // Always judge the pass — the one that ships (the final, over-budget attempt) is the most
      // worth a verdict for oversight, so we judge every attempt and only gate *retries* on budget.
      const verdict = await this.judge.assess({
        jobId: p.job.id,
        repoFullName: this.repoLabel(p.job),
        baseBranch: p.ws.baseBranch,
        phase: p.phase,
        goal: p.goal,
        context: p.context,
        agentOutput: res.stdout,
        cwd: p.ws.dir,
        attempt,
      });

      if (verdict.passed) {
        break;
      }

      // Judged incomplete but out of retry budget: this pass ships to VERIFY/REVIEW regardless.
      if (attempt > maxRetries) {
        this.logger.warn(
          `[job ${p.job.id}] ${p.phase} completion budget (${maxRetries}) exhausted after ${attempt} attempts; proceeding with possible gaps`,
        );
        break;
      }

      // Re-level the judge's critique headings so they nest under the next prompt's sections
      // instead of colliding with them; the verbatim critique stays in the run's stdout.
      critique = relevelCritique(verdict.critique);

      this.logger.log(
        `[job ${p.job.id}] ${p.phase} judged incomplete (attempt ${attempt}); continuing with judge critique`,
      );
    }
  }

  /**
   * The VERIFY stage: run the repo's discovered tests/build command against the
   * committed branch as a ground-truth gate. A pass advances to self-review; a failure
   * routes to REVISE (re-verified after the fix). It runs after IMPLEMENT and after
   * every REVISE, so all post-implement failures funnel through REVISE.
   */
  private async handleVerify(jobId: string): Promise<void> {
    const { job, installation, ref } = await this.context(jobId);

    if (job.state !== 'VERIFYING') {
      await this.jobs.transition(jobId, 'VERIFYING', { reason: 're-verifying', actor: 'AGENT' });
    }

    const ws = await this.workspace.prepare({
      jobId,
      auth: this.remoteAuthFor(job, installation),
      branchName: this.branchFor(job),
    });

    const cycle = job.reviewCycle;
    const verifyCommand = await this.verifyCommandFor(job, ws.dir);

    // No automated checks in the repo (yet) — nothing to run, proceed to self-review.
    if (!verifyCommand) {
      await this.jobs.transition(jobId, 'SELF_REVIEWING', {
        reason: 'no verify command; skipping to review',
        actor: 'AGENT',
      });

      await this.queue.enqueue({ jobId, kind: 'REVIEW' });

      return;
    }

    await rm(join(ws.dir, '.olympian'), { force: true, recursive: true });

    const startedAt = Date.now();
    let verify = await this.workspace.runVerify(jobId, ws.dir, verifyCommand);

    // A failed verify is retried once before routing to a (multi-minute) REVISE — one
    // extra run is cheap insurance against a transient install/network flake causing a
    // false failure on otherwise-passing code.
    if (verify && !verify.ok) {
      this.logger.warn(`[job ${jobId}] verify failed; retrying once to rule out a transient flake`);
      verify = await this.workspace.runVerify(jobId, ws.dir, verifyCommand);
    }

    const durationMs = Date.now() - startedAt;
    const result = verify ?? { ok: true, output: '' };

    const attempt = (await this.verify.countForCycle(jobId, cycle)) + 1;

    await this.verify.record({
      jobId,
      cycle,
      attempt,
      command: verifyCommand,
      ok: result.ok,
      output: result.output,
      durationMs,
    });

    if (result.ok) {
      await this.jobs.transition(jobId, 'SELF_REVIEWING', {
        reason: `verify passed (attempt ${attempt})`,
        actor: 'AGENT',
      });

      await this.queue.enqueue({ jobId, kind: 'REVIEW' });

      return;
    }

    this.logger.warn(`[job ${jobId}] verify failed on attempt ${attempt}`);

    // Cap the VERIFY→REVISE loop; beyond it, open a draft PR with tests still red.
    if (attempt < this.config.get('MAX_VERIFY_ATTEMPTS')) {
      await this.jobs.transition(jobId, 'REVISING', {
        reason: `verify failed (attempt ${attempt})`,
        actor: 'AGENT',
      });

      await this.queue.enqueue({ jobId, kind: 'REVISE' });

      return;
    }

    await this.safeComment(
      ref,
      job.prNumber ?? job.issueNumber,
      `The verification command (\`${verifyCommand}\`) is still failing after ${attempt} attempts. Opening a draft PR for human review.`,
    );

    await this.jobs.transition(jobId, 'OPENING_PR', {
      reason: 'verify cap reached',
      actor: 'AGENT',
    });
    await this.queue.enqueue({ jobId, kind: 'OPEN_PR' });
  }

  private async handleRevise(jobId: string): Promise<void> {
    const { job, installation } = await this.context(jobId);

    const auth = this.remoteAuthFor(job, installation);

    const ws = await this.workspace.prepare({
      jobId,
      auth,
      branchName: this.branchFor(job),
    });

    const plan = await this.approvedPlan(jobId);

    // PR feedback is only relevant if it was submitted after the last IMPLEMENT run;
    // anything older was already incorporated into the code by that IMPLEMENT pass.
    const lastImplementRun = await this.prisma.agentRun.findFirst({
      where: { jobId, phase: 'IMPLEMENT' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const [reviewPasses, prFeedback] = await Promise.all([
      this.prisma.reviewPass.findMany({
        where: { jobId, cycle: job.reviewCycle },
        orderBy: { passNumber: 'desc' },
        take: 2,
        select: { issues: true },
      }),
      this.prisma.pullRequestFeedback.findMany({
        where: {
          jobId,
          ...(lastImplementRun ? { createdAt: { gt: lastImplementRun.createdAt } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const latestIssues: ReviewIssue[] = reviewPasses[0]
      ? (JSON.parse(reviewPasses[0].issues) as ReviewIssue[])
      : [];

    const priorIssues: ReviewIssue[] =
      reviewPasses.length > 1 ? (JSON.parse(reviewPasses[1].issues) as ReviewIssue[]) : [];

    const humanFeedback =
      prFeedback.length > 0
        ? this.formatPrFeedback(
            prFeedback.map((r) => ({
              author: r.author,
              body: r.body,
              path: r.path ?? undefined,
              line: r.line ?? undefined,
            })),
          )
        : undefined;

    // If the most recent verify in this cycle failed, the build/tests are the priority
    // fix — surface their output to the revise agent.
    const lastVerify = await this.prisma.verifyRun.findFirst({
      where: { jobId, cycle: job.reviewCycle },
      orderBy: { createdAt: 'desc' },
      select: { ok: true, command: true, output: true },
    });

    const verifyFailure =
      lastVerify && !lastVerify.ok
        ? `The verification command \`${lastVerify.command}\` failed:\n\n${lastVerify.output.slice(0, 4000)}`
        : undefined;

    // Download any attachments referenced in the human feedback (and the issue) so the agent
    // can open them locally — it can't fetch GitHub URLs from the sandbox. Mirrors IMPLEMENT.
    // GitHub-only: dashboard jobs have no installation token to fetch attachments with.
    const downloaded = job.installationId
      ? await this.workspace.downloadAttachments(
          ws.dir,
          Number(job.installationId),
          extractAttachmentUrls([job.issueBody, ...prFeedback.map((r) => r.body)].join('\n')),
        )
      : [];

    const attachments = formatDownloadedAttachments(downloaded);

    const revisionNumber =
      (await this.prisma.agentRun.count({ where: { jobId, phase: 'REVISE' } })) + 1;

    // The judge's "goal" for a revision is the set of things it was asked to resolve.
    const goal =
      [
        verifyFailure ? `Failing build/tests:\n${verifyFailure}` : '',
        latestIssues.length > 0 ? `Review issues to fix:\n${formatIssues(latestIssues)}` : '',
        humanFeedback ? `Human feedback to address:\n${humanFeedback}` : '',
      ]
        .filter(Boolean)
        .join('\n\n') || 'Resolve all outstanding review issues and make the build/tests pass.';

    const buildPrompt = (critique: string | undefined, progress: string | undefined) =>
      buildRevisePrompt({
        jobId,
        plan,
        verifyFailure,
        latestIssuesText: latestIssues.length > 0 ? formatIssues(latestIssues) : undefined,
        priorIssuesText: priorIssues.length > 0 ? formatIssues(priorIssues) : undefined,
        humanFeedback,
        attachments,
        // On a continuation the judge's critique lists what the prior pass left unfinished.
        incompleteWork: critique,
        progress,
      });

    await this.runWithCompletionLoop({
      job,
      auth,
      phase: 'REVISE',
      ws,
      goal,
      context: plan,
      buildPrompt: (attempt, critique, progress) => buildPrompt(critique, progress),
      commitMessage: (attempt) => reviseCommitMessage(revisionNumber + attempt - 1),
      noChangesError: 'revision produced no file changes — issues were not addressed',
    });

    await this.jobs.transition(jobId, 'VERIFYING', {
      reason: 'revision complete',
      actor: 'AGENT',
    });
    await this.queue.enqueue({ jobId, kind: 'VERIFY' });
  }

  private async handleReview(jobId: string): Promise<void> {
    const { job, installation, ref } = await this.context(jobId);

    const ws = await this.workspace.prepare({
      jobId,
      auth: this.remoteAuthFor(job, installation),
      branchName: this.branchFor(job),
    });

    const base = ws.baseBranch;
    const plan = await this.approvedPlan(jobId);
    const maxPasses = this.review.maxPasses;
    const cycle = job.reviewCycle;

    // Count only passes in the current cycle so the cap applies per-cycle and task
    // retries continue from where they left off rather than restarting from pass 1.
    const [priorPasses, priorUnparseable] = await Promise.all([
      this.prisma.reviewPass.count({ where: { jobId, cycle } }),
      this.prisma.reviewPass.count({ where: { jobId, cycle, confidence: 0 } }),
    ]);
    const pass = priorPasses + 1;

    // Fetch issues from the immediately preceding pass (if any) so the reviewer
    // can explicitly verify each was resolved in addition to doing a full fresh review.
    const priorPassRecord =
      pass > 1
        ? await this.prisma.reviewPass.findFirst({
            where: { jobId, cycle },
            orderBy: { passNumber: 'desc' },
            select: { issues: true },
          })
        : null;

    const priorIssues = priorPassRecord
      ? (JSON.parse(priorPassRecord.issues) as ReviewIssue[])
      : undefined;

    // Only include PR feedback submitted after the last IMPLEMENT run — older
    // feedback was already incorporated into the code at that point.
    const lastImplementRunForReview = await this.prisma.agentRun.findFirst({
      where: { jobId, phase: 'IMPLEMENT' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const prFeedback = await this.prisma.pullRequestFeedback.findMany({
      where: {
        jobId,
        ...(lastImplementRunForReview
          ? { createdAt: { gt: lastImplementRunForReview.createdAt } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const humanFeedback =
      prFeedback.length > 0
        ? this.formatPrFeedback(
            prFeedback.map((r) => ({
              author: r.author,
              body: r.body,
              path: r.path ?? undefined,
              line: r.line ?? undefined,
            })),
          )
        : undefined;

    await this.jobs.transition(jobId, 'SELF_REVIEWING', {
      reason: `review pass ${pass}`,
      actor: 'AGENT',
    });

    const hasBrowser = !!process.env.CAMOFOX_URL;

    const changedFiles = await this.workspace.branchChangedFiles(ws.dir, base);

    // The VERIFY stage already ran (and passed, or there was no command) before review
    // was enqueued — carry its result through for the record and the gate.
    const lastVerify = await this.prisma.verifyRun.findFirst({
      where: { jobId, cycle },
      orderBy: { createdAt: 'desc' },
      select: { ok: true },
    });
    const verifyOk = lastVerify ? lastVerify.ok : null;

    // Scope check: files changed on the branch the approved plan never declared.
    const outOfPlanFiles = outOfPlanChanges(changedFiles, planFilePaths(plan));

    const reviewPrompt = buildReviewPrompt({
      repoFullName: this.repoLabel(job),
      issueTitle: job.issueTitle,
      issueBody: job.issueBody,
      plan,
      baseBranch: base,
      changedFiles,
      threshold: this.review.threshold,
      humanFeedback,
      priorIssues,
      hasBrowser,
      parseRetry: priorUnparseable > 0,
      outOfPlanFiles,
    });

    await rm(join(ws.dir, '.olympian'), { force: true, recursive: true });

    const res = await this.agent.run({
      jobId,
      phase: 'REVIEW',
      cwd: ws.dir,
      prompt: reviewPrompt,
      model: this.config.get('HERMES_REVIEW_MODEL') || undefined,
      provider: this.config.get('HERMES_REVIEW_PROVIDER') || undefined,
    });

    if (res.status !== 'SUCCEEDED') {
      throw new Error(`review agent ${res.status}; ${res.stderr.slice(0, 300)}`);
    }

    const parsed = parseReview(res.stdout);

    // The process exited cleanly, but a review that produced no parseable verdict didn't
    // actually do its job (premature exit / context exhaustion). Record it as FAILED so
    // the run isn't a phantom success — the cycle still recovers via the retry below.
    if (parsed === null) {
      await this.agent.markRunFailed(
        res.runId,
        'review produced no parseable JSON verdict — likely a premature exit or context exhaustion',
      );
    }

    const result: ReviewResult = parsed
      ? { ...parsed, verifyOk }
      : {
          confidence: 0,
          verdict: 'FAIL',
          dimensions: {
            correctness: false,
            tests: false,
            planCoverage: false,
            security: false,
          },
          issues: [
            {
              severity: 'high',
              title: 'Unparseable review output',
              detail: res.stdout.slice(0, 800),
            },
          ],
          verifyOk,
        };

    await this.review.persist({ jobId, cycle, passNumber: pass, result });

    if (this.review.meetsThreshold(result)) {
      await this.jobs.transition(jobId, 'OPENING_PR', {
        reason: 'review complete',
        actor: 'AGENT',
      });

      await this.queue.enqueue({ jobId, kind: 'OPEN_PR' });

      return;
    }

    // Count how many passes in this cycle produced no parseable JSON verdict.
    // After 2 consecutive unparseable passes the model is unlikely to self-correct,
    // so fall through to the draft-PR path rather than burning the entire pass budget.
    const unparseablePasses = priorUnparseable + (parsed === null ? 1 : 0);

    // Only revise when the review produced parseable, actionable issues.
    // If the output couldn't be parsed, retry the review so the agent gets another
    // chance to emit valid JSON — but cap unparseable retries at 2.
    if (pass < maxPasses && (parsed !== null || unparseablePasses < 2)) {
      if (parsed !== null) {
        await this.jobs.transition(jobId, 'REVISING', {
          reason: `addressing review pass ${pass}`,
          actor: 'AGENT',
        });

        await this.queue.enqueue({ jobId, kind: 'REVISE' });
      } else {
        await this.queue.enqueue({ jobId, kind: 'REVIEW' });
      }
      return;
    }

    const reason =
      unparseablePasses >= 2
        ? `Self-review produced unparseable output ${unparseablePasses} times in a row. Opening a draft PR for human review.`
        : `Self-review didn't reach the confidence threshold after ${pass} passes (best ${result.confidence}/100). Opening a draft PR for human review.`;

    await this.safeComment(ref, job.issueNumber, reason);

    await this.jobs.transition(jobId, 'OPENING_PR', {
      reason: 'review cap reached',
      actor: 'AGENT',
    });

    await this.queue.enqueue({ jobId, kind: 'OPEN_PR' });
  }

  private async handleOpenPr(jobId: string): Promise<void> {
    const { job, installation, ref } = await this.context(jobId);

    // Guard: if a reviewer requested changes while this cycle was wrapping up, that feedback
    // arrived after the last work pass and hasn't been addressed — loop back to REVISE rather
    // than presenting the PR for approval. (The next REVISE/IMPLEMENT then folds it in.)
    const lastWorkRun = await this.prisma.agentRun.findFirst({
      where: { jobId, phase: { in: ['IMPLEMENT', 'REVISE'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const unaddressedFeedback = await this.prisma.pullRequestFeedback.count({
      where: {
        jobId,
        ...(lastWorkRun ? { createdAt: { gt: lastWorkRun.createdAt } } : {}),
      },
    });

    if (unaddressedFeedback > 0) {
      this.logger.log(
        `[job ${jobId}] ${unaddressedFeedback} PR comment(s) arrived since the last work pass; revising before opening for approval`,
      );

      await this.jobs.transition(jobId, 'REVISING', {
        reason: 'unaddressed PR feedback',
        actor: 'AGENT',
      });

      await this.queue.enqueue({ jobId, kind: 'REVISE' });

      return;
    }

    const branchName = this.branchFor(job);
    const auth = this.remoteAuthFor(job, installation);

    // Dashboard jobs have no GitHub App, so there's no PR to open: push the branch over SSH
    // (or no-op for a scratch repo) and present the diff for Accept / Request changes in the UI.
    if (job.origin === 'DASHBOARD') {
      const headSha = await this.workspace.push({
        jobId,
        auth,
        branchName,
      });

      await this.jobs.update(jobId, { headSha });

      await this.jobs.transition(jobId, 'AWAITING_PR_APPROVAL', {
        reason: job.repoUrl
          ? 'branch pushed; awaiting result approval'
          : 'awaiting result approval',
        actor: 'AGENT',
      });

      return;
    }

    const base = await this.github.getDefaultBranch(ref!);

    const headSha = await this.workspace.push({
      jobId,
      auth,
      branchName,
      baseBranch: base,
    });

    await this.jobs.update(jobId, { headSha });

    const lastReview = await this.prisma.reviewPass.findFirst({
      where: { jobId, cycle: job.reviewCycle },
      orderBy: { passNumber: 'desc' },
    });

    const lastResult = lastReview ? reviewResultFromRecord(lastReview) : null;
    const meets = lastResult ? this.review.meetsThreshold(lastResult) : false;
    const failedChecks = lastResult ? failedDimensions(lastResult.dimensions) : [];

    const unresolved = lastReview ? formatIssues(JSON.parse(lastReview.issues)) : undefined;

    if (!job.prNumber) {
      const prBodyRes = await this.agent.run({
        jobId,
        phase: 'SUMMARY',
        cwd: this.workspace.dir(jobId),
        prompt: buildSummaryPrompt({
          repoFullName: this.repoLabel(job),
          issueNumber: job.issueNumber ?? 0,
          issueTitle: job.issueTitle,
          issueBody: job.issueBody,
          baseBranch: base,
          branchName,
        }),
      });

      const agentSummary =
        prBodyRes.status === 'SUCCEEDED' && prBodyRes.stdout.trim().length > 0
          ? prBodyRes.stdout.trim().slice(0, 8_000)
          : `Resolves #${job.issueNumber}: ${job.issueTitle}`;

      const body = buildPrBody({
        issueNumber: job.issueNumber ?? 0,
        agentSummary,
        confidence: lastReview?.confidence ?? null,
        meetsThreshold: meets,
        verifyOk: lastResult?.verifyOk ?? null,
        failedDimensions: failedChecks,
        unresolvedIssues: unresolved,
      });

      const pr = await this.github.createDraftPullRequest(ref!, {
        title: `[Hermes] ${job.issueTitle}`.slice(0, 250),
        head: branchName,
        base,
        body,
      });

      await this.prisma.pullRequest.create({
        data: {
          jobId,
          prNumber: pr.number,
          url: pr.url,
          state: 'open',
          isDraft: true,
          headSha: pr.headSha,
        },
      });

      await this.jobs.update(jobId, { prNumber: pr.number, headSha: pr.headSha });

      await this.safeComment(
        ref,
        job.issueNumber,
        `Opened draft PR #${pr.number} for review: ${pr.url}`,
      );
    } else {
      await this.prisma.pullRequest.updateMany({ where: { jobId }, data: { headSha } });

      await this.safeComment(
        ref,
        job.prNumber,
        `Pushed an update addressing the latest feedback. Please re-review.`,
      );
    }

    await this.jobs.transition(jobId, 'AWAITING_PR_APPROVAL', {
      reason: 'draft PR ready',
      actor: 'AGENT',
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async context(
    jobId: string,
  ): Promise<{ job: JobRecords; installation: RepoInstallation | null; ref: RepoRef | null }> {
    const job = await this.prisma.jobRecords.findUnique({
      where: { id: jobId },
      include: { installation: true },
    });

    if (!job) {
      throw new Error(`job ${jobId} not found`);
    }

    return { job, installation: job.installation, ref: this.refFor(job, job.installation) };
  }

  /** RepoRef for GitHub-origin jobs; null for dashboard jobs (no installation to act through). */
  private refFor(job: JobRecords, installation: RepoInstallation | null): RepoRef | null {
    if (!installation || !job.repoOwner || !job.repoName) {
      return null;
    }

    return {
      installationId: Number(installation.installationId),
      owner: job.repoOwner,
      repo: job.repoName,
    };
  }

  /**
   * How this job's workspace authenticates to its remote (drives clone/push). The GitHub
   * App installation id is the BigInt on the related RepoInstallation — NOT `Job.installationId`,
   * which is the cuid FK to that row — so the installation record must be passed in.
   */
  private remoteAuthFor(job: JobRecords, installation: RepoInstallation | null): RemoteAuth {
    if (job.origin === 'DASHBOARD') {
      return job.repoUrl ? { kind: 'ssh', url: job.repoUrl } : { kind: 'none' };
    }

    if (!installation) {
      throw new Error(`GitHub job ${job.id} has no installation record`);
    }

    return {
      kind: 'github-app',
      installationId: Number(installation.installationId),
      owner: job.repoOwner ?? '',
      repo: job.repoName ?? '',
    };
  }

  /** Branch name for a job — GitHub jobs key off the issue number, dashboard jobs off the id. */
  private branchFor(job: JobRecords): string {
    if (job.branchName) {
      return job.branchName;
    }

    const prefix = this.config.get('BRANCH_PREFIX');

    return job.origin === 'DASHBOARD'
      ? `${prefix}dashboard-${job.id.slice(0, 8)}`
      : branchNameFor(prefix, job.issueNumber ?? 0);
  }

  /** Human/agent-facing repo label for prompts — falls back gracefully for dashboard jobs. */
  private repoLabel(job: JobRecords): string {
    return job.repoFullName ?? job.repoUrl ?? 'the working repository';
  }

  /**
   * Best-effort push of the job branch so a human can inspect in-progress work on GitHub
   * during the implement/revise loop. A push failure is non-fatal — it's logged and the
   * stage continues; the branch is pushed for real (and gated) at OPEN_PR.
   */
  private async pushBranch(job: JobRecords, auth: RemoteAuth, branchName: string): Promise<void> {
    try {
      const headSha = await this.workspace.push({
        jobId: job.id,
        auth,
        branchName,
      });

      await this.jobs.update(job.id, { headSha });
    } catch (e) {
      this.logger.warn(
        `[job ${job.id}] intermediate branch push failed (non-fatal): ${(e as Error).message}`,
      );
    }
  }

  private async upsertInstallation(evt: IssueLabeledEvent): Promise<RepoInstallation> {
    return this.prisma.repoInstallation.upsert({
      where: { installationId: BigInt(evt.installationId) },
      create: {
        installationId: BigInt(evt.installationId),
        accountLogin: evt.accountLogin,
        accountType: evt.accountType,
      },
      update: { accountLogin: evt.accountLogin, accountType: evt.accountType },
    });
  }

  /**
   * Resolves the repo's verification command. A dedicated agent step discovers it (the
   * agent is good at finding the right command for any toolchain); the orchestrator
   * EXECUTES it (see workspace.runVerify) so the pass/fail result is ground truth, not
   * self-reported. Returns null when there is no command.
   *
   * A previously discovered, NON-EMPTY command is stable, so it is cached and reused
   * across cycles. A null (never discovered) or empty (no checks found yet) value
   * re-triggers discovery — so a greenfield project that adds a test runner mid-job is
   * picked up on a later cycle rather than running ungated forever.
   */
  private async verifyCommandFor(job: JobRecords, dir: string): Promise<string | null> {
    if (job.verifyCommand && job.verifyCommand.trim() !== '') {
      return job.verifyCommand;
    }

    const res = await this.agent.run({
      jobId: job.id,
      phase: 'VERIFY',
      cwd: dir,
      prompt: buildVerifyPrompt({ repoFullName: this.repoLabel(job) }),
      timeoutMs: 10 * 60 * 1000,
    });

    if (res.status !== 'SUCCEEDED') {
      // Don't persist — leave it unset so a later cycle can retry discovery.
      this.logger.warn(`[job ${job.id}] verify discovery ${res.status}; running without a gate`);
      return null;
    }

    const command = parseVerifyCommand(res.stdout);

    await this.jobs.update(job.id, { verifyCommand: command });
    this.logger.log(`[job ${job.id}] discovered verify command: ${command || '(none)'}`);

    return command === '' ? null : command;
  }

  private async approvedPlan(jobId: string): Promise<string> {
    const approved = await this.prisma.planRevision.findFirst({
      where: { jobId, status: 'APPROVED' },
      orderBy: { revision: 'desc' },
    });

    if (approved) {
      return approved.content;
    }

    const latest = await this.prisma.planRevision.findFirst({
      where: { jobId },
      orderBy: { revision: 'desc' },
    });

    return latest?.content ?? '(no plan recorded)';
  }

  private async isAuthorized(ref: RepoRef, username: string): Promise<boolean> {
    const permission = await this.github.getCollaboratorPermission(ref, username);

    return APPROVAL_PERMISSIONS.has(permission);
  }

  private formatPrFeedback(feedback: ReviewFeedback[]): string {
    if (feedback.length === 0) {
      return 'A reviewer requested changes but left no specific comments; re-examine the diff for issues.';
    }

    return feedback
      .map(
        (f, i) =>
          `${i + 1}. @${f.author}${f.path ? ` on ${f.path}${f.line ? `:${f.line}` : ''}` : ''}: ${f.body}`,
      )
      .join('\n');
  }

  // The safe* helpers accept a nullable ref so dashboard jobs (no GitHub surface) call
  // them harmlessly: a null ref means "no issue/PR to talk to", so they no-op.

  private async safeComment(
    ref: RepoRef | null,
    issueOrPr: number | null,
    body: string,
  ): Promise<void> {
    if (!ref || issueOrPr === null) {
      return;
    }

    try {
      await this.github.createIssueComment(ref, issueOrPr, body);
    } catch (e) {
      this.logger.warn(`failed to post comment: ${(e as Error).message}`);
    }
  }

  private async safeReaction(
    ref: RepoRef | null,
    issueNumber: number | null,
    content: Parameters<GithubService['createIssueReaction']>[2],
  ): Promise<void> {
    if (!ref || issueNumber === null) {
      return;
    }

    try {
      await this.github.createIssueReaction(ref, issueNumber, content);
    } catch (e) {
      this.logger.warn(`failed to add reaction: ${(e as Error).message}`);
    }
  }

  private async safeCommentReaction(
    ref: RepoRef | null,
    commentId: number,
    content: Parameters<GithubService['createCommentReaction']>[2],
  ): Promise<void> {
    if (!ref) {
      return;
    }

    try {
      await this.github.createCommentReaction(ref, commentId, content);
    } catch (e) {
      this.logger.warn(`failed to add comment reaction: ${(e as Error).message}`);
    }
  }
}
