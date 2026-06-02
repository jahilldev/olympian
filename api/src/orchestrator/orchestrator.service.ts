import { Injectable, Logger } from '@nestjs/common';
import { type Job, type QueueTask, type RepoInstallation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { JobService } from '../job/job.service.js';
import { branchNameFor } from '../job/job.utility.js';
import { QueueService } from '../queue/queue.service.js';
import { type TaskKind } from '../queue/queue.model.js';
import { HermesAgentService } from '../agent/agent.service.js';
import {
  buildImplementPrompt,
  buildPlanPrompt,
  buildRevisePrompt,
} from '../agent/agent.prompts.js';
import { WorkspaceService } from '../workspace/workspace.service.js';
import { ReviewService } from '../review/review.service.js';
import { buildReviewPrompt } from '../review/review.prompts.js';
import { type ReviewResult } from '../review/review.model.js';
import { formatIssues, parseReview } from '../review/review.utility.js';
import { GithubService } from '../github/github.service.js';
import {
  APPROVAL_PERMISSIONS,
  type RepoRef,
  type ReviewFeedback,
} from '../github/github.model.js';
import {
  type IssueCommentEvent,
  type IssueLabeledEvent,
  type PrReviewEvent,
} from './orchestrator.model.js';
import {
  buildPrBody,
  buildStatusReport,
  implementCommitMessage,
  parseCommand,
  reviseCommitMessage,
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
      this.logger.debug(
        `Job already exists for ${repoFullName}#${evt.issueNumber}; ignoring label`,
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
    const job = await this.jobs.findByRepoIssue(repoFullName, evt.issueNumber);
    if (!job) {
      return;
    }
    const { ref } = await this.context(job.id);
    const command = parseCommand(evt.body, this.config.get('COMMAND_PREFIX'));

    if (command.kind === 'status') {
      const [activeRun, reviewPassCount, activeTask, prRef] = await Promise.all([
        this.prisma.agentRun.findFirst({
          where: { jobId: job.id, status: 'RUNNING' },
          orderBy: { createdAt: 'desc' },
          select: { phase: true, createdAt: true },
        }),
        this.prisma.reviewPass.count({ where: { jobId: job.id } }),
        this.prisma.queueTask.findFirst({
          where: { jobId: job.id, status: { in: ['PENDING', 'RUNNING'] } },
          orderBy: { createdAt: 'desc' },
          select: { attempts: true, maxAttempts: true, lastError: true },
        }),
        this.prisma.pullRequestRef.findUnique({
          where: { jobId: job.id },
          select: { prNumber: true },
        }),
      ]);
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
        }),
      );
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
      await this.queue.cancelForJob(job.id);
      await this.jobs.transition(job.id, 'CANCELLED', {
        reason: `cancelled by @${evt.author}`,
        actor: 'HUMAN',
      });
      await this.safeComment(ref, evt.issueNumber, `Cancelled. Re-label the issue to start over.`);
      return;
    }

    // Plan controls only apply while awaiting plan approval.
    if (job.state !== 'AWAITING_PLAN_APPROVAL') {
      return;
    }

    if (command.kind === 'approve') {
      await this.prisma.planRevision.updateMany({
        where: { jobId: job.id, status: 'PROPOSED' },
        data: { status: 'APPROVED' },
      });
      await this.jobs.transition(job.id, 'IMPLEMENTING', {
        reason: `plan approved by @${evt.author}`,
        actor: 'HUMAN',
      });
      await this.queue.enqueue({ jobId: job.id, kind: 'IMPLEMENT' });
      await this.safeComment(
        ref,
        evt.issueNumber,
        `Plan approved — implementing now. I'll open a draft PR when it's ready.`,
      );
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
    await this.prisma.planFeedback.create({
      data: {
        jobId: job.id,
        author: evt.author,
        body: evt.body,
        githubCommentId: BigInt(evt.commentId),
      },
    });
    await this.prisma.planRevision.updateMany({
      where: { jobId: job.id, status: 'PROPOSED' },
      data: { status: 'SUPERSEDED' },
    });
    await this.jobs.transition(job.id, 'PLANNING', {
      reason: `feedback from @${evt.author}`,
      actor: 'HUMAN',
    });
    await this.queue.enqueue({ jobId: job.id, kind: 'PLAN' });
  }

  async onPullRequestReview(evt: PrReviewEvent): Promise<void> {
    if (evt.isBot) {
      return;
    }
    const repoFullName = `${evt.owner}/${evt.repo}`;
    const job = await this.prisma.job.findFirst({
      where: { repoFullName, prNumber: evt.prNumber },
    });
    if (!job || job.state !== 'AWAITING_PR_APPROVAL') {
      return;
    }
    const { ref } = await this.context(job.id);
    if (!(await this.isAuthorized(ref, evt.author))) {
      return;
    }

    if (evt.state === 'approved') {
      await this.prisma.pullRequestRef.updateMany({
        where: { jobId: job.id },
        data: { state: 'open' },
      });
      await this.jobs.transition(job.id, 'DONE', {
        reason: `PR approved by @${evt.author}`,
        actor: 'HUMAN',
      });
      await this.safeComment(ref, evt.prNumber, `Approved — Hermes is done here. 🎉`);
      await this.workspace.cleanup(job.id).catch(() => undefined);
      return;
    }
    if (evt.state === 'changes_requested') {
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
    }
  }

  // ── Queue task processing ──────────────────────────────────────────────────

  async processTask(task: QueueTask): Promise<void> {
    const kind = task.kind as TaskKind;
    switch (kind) {
      case 'PLAN':
        return this.handlePlan(task.jobId);
      case 'IMPLEMENT':
        return this.handleImplement(task.jobId);
      case 'REVIEW':
        return this.handleReview(task.jobId);
      case 'OPEN_PR':
        return this.handleOpenPr(task.jobId);
      case 'REVISE':
        // Revisions run inline within REVIEW; nothing to do as a standalone task.
        return;
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

  // ── Stage handlers ─────────────────────────────────────────────────────────

  private async handlePlan(jobId: string): Promise<void> {
    const { job, installation, ref } = await this.context(jobId);
    await this.jobs.transition(jobId, 'PLANNING', { reason: 'drafting plan', actor: 'AGENT' });

    const branchName =
      job.branchName ?? branchNameFor(this.config.get('BRANCH_PREFIX'), job.issueNumber);
    const ws = await this.workspace.prepare({
      jobId,
      installationId: this.ghId(installation),
      owner: job.repoOwner,
      repo: job.repoName,
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

    const prompt = buildPlanPrompt({
      repoFullName: job.repoFullName,
      issueNumber: job.issueNumber,
      issueTitle: job.issueTitle,
      issueBody: job.issueBody,
      priorPlan: lastRevision?.content,
      feedback: feedback.map((f) => f.body),
    });
    const res = await this.agent.run({ jobId, phase: 'PLAN', cwd: ws.dir, prompt });
    if (res.status !== 'SUCCEEDED' || res.stdout.trim().length === 0) {
      throw new Error(`planning failed (${res.status}); ${res.stderr.slice(0, 300)}`);
    }

    const nextRevision = (lastRevision?.revision ?? 0) + 1;
    const planContent = res.stdout.trim();
    const commentBody = this.renderPlanComment(planContent);
    const commentId = await this.github.createIssueComment(ref, job.issueNumber, commentBody);
    await this.prisma.planRevision.create({
      data: {
        jobId,
        revision: nextRevision,
        content: planContent,
        status: 'PROPOSED',
        githubCommentId: BigInt(commentId),
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
    const ghId = this.ghId(installation);
    const branchName =
      job.branchName ?? branchNameFor(this.config.get('BRANCH_PREFIX'), job.issueNumber);
    const ws = await this.workspace.prepare({
      jobId,
      installationId: ghId,
      owner: job.repoOwner,
      repo: job.repoName,
      branchName,
    });
    if (!job.branchName) {
      await this.jobs.update(jobId, { branchName });
    }

    const plan = await this.approvedPlan(jobId);
    let guidance: string | undefined;
    if (job.prNumber) {
      const fb = await this.github.getReviewFeedback(this.refFor(job, installation), job.prNumber);
      guidance = this.formatPrFeedback(fb);
    }

    const maxIters = this.config.get('MAX_IMPLEMENTATION_ITERATIONS');
    let committedSomething = false;
    for (let attempt = 1; attempt <= maxIters; attempt++) {
      const prompt = buildImplementPrompt({
        repoFullName: job.repoFullName,
        issueTitle: job.issueTitle,
        issueBody: job.issueBody,
        plan,
        attempt,
        guidance,
      });
      const res = await this.agent.run({ jobId, phase: 'IMPLEMENT', cwd: ws.dir, prompt });
      if (res.status !== 'SUCCEEDED') {
        throw new Error(`implementation agent ${res.status}; ${res.stderr.slice(0, 300)}`);
      }
      const sha = await this.workspace.commitAll(
        ws.dir,
        implementCommitMessage(job.issueNumber, job.issueTitle, attempt),
      );
      committedSomething ||= sha !== null;
      await this.jobs.incrementAttempts(jobId);

      const verify = await this.workspace.runVerify(ws.dir);
      if (!verify || verify.ok) {
        break;
      }
      guidance = `The verification command failed (exit non-zero). Fix the root cause.\n\n${verify.output.slice(0, 4000)}`;
      this.logger.warn(`[job ${jobId}] verify failed on attempt ${attempt}; iterating`);
    }

    if (!committedSomething && !(await this.workspace.hasCommitsAhead(ws.dir, ws.baseBranch))) {
      throw new Error('agent produced no changes');
    }
    await this.jobs.transition(jobId, 'SELF_REVIEWING', {
      reason: 'implementation complete',
      actor: 'AGENT',
    });
    await this.queue.enqueue({ jobId, kind: 'REVIEW' });
  }

  private async handleReview(jobId: string): Promise<void> {
    const { job, ref } = await this.context(jobId);
    const ws = await this.workspace.prepare({
      jobId,
      installationId: this.ghIdFromRef(ref),
      owner: job.repoOwner,
      repo: job.repoName,
      branchName:
        job.branchName ?? branchNameFor(this.config.get('BRANCH_PREFIX'), job.issueNumber),
    });
    const base = ws.baseBranch;
    const plan = await this.approvedPlan(jobId);
    const maxPasses = this.review.maxPasses;
    let result: ReviewResult | null = null;

    for (let pass = 1; pass <= maxPasses; pass++) {
      // Idempotent: a no-op when already SELF_REVIEWING, REVISING -> SELF_REVIEWING otherwise.
      await this.jobs.transition(jobId, 'SELF_REVIEWING', {
        reason: `review pass ${pass}`,
        actor: 'AGENT',
      });
      const changedFiles = await this.workspace.branchChangedFiles(ws.dir, base);
      const reviewPrompt = buildReviewPrompt({
        repoFullName: job.repoFullName,
        issueTitle: job.issueTitle,
        issueBody: job.issueBody,
        plan,
        baseBranch: base,
        changedFiles,
        threshold: this.review.threshold,
      });
      const res = await this.agent.run({
        jobId,
        phase: 'REVIEW',
        cwd: ws.dir,
        prompt: reviewPrompt,
      });
      if (res.status !== 'SUCCEEDED') {
        throw new Error(`review agent ${res.status}; ${res.stderr.slice(0, 300)}`);
      }
      result = parseReview(res.stdout) ?? {
        confidence: 0,
        verdict: 'FAIL',
        issues: [
          {
            severity: 'high',
            title: 'Unparseable review output',
            detail: res.stdout.slice(0, 800),
          },
        ],
      };
      await this.review.persist(jobId, pass, result);

      if (this.review.meetsThreshold(result)) {
        break;
      }
      if (pass < maxPasses) {
        await this.jobs.transition(jobId, 'REVISING', {
          reason: `addressing review pass ${pass}`,
          actor: 'AGENT',
        });
        const revisePrompt = buildRevisePrompt({ plan, issuesText: formatIssues(result.issues) });
        const rev = await this.agent.run({
          jobId,
          phase: 'REVISE',
          cwd: ws.dir,
          prompt: revisePrompt,
        });
        if (rev.status !== 'SUCCEEDED') {
          throw new Error(`revise agent ${rev.status}; ${rev.stderr.slice(0, 300)}`);
        }
        await this.workspace.commitAll(ws.dir, reviseCommitMessage(pass));
      }
    }

    // The loop always ends after a review pass (revisions only happen mid-loop),
    // so the job is in SELF_REVIEWING here. The cap path still opens a draft PR.
    if (result && !this.review.meetsThreshold(result)) {
      await this.safeComment(
        ref,
        job.issueNumber,
        `Self-review didn't reach the confidence threshold after ${maxPasses} passes (best ${result.confidence}/100). Opening a draft PR for human review.`,
      );
    }
    await this.jobs.transition(jobId, 'OPENING_PR', { reason: 'review complete', actor: 'AGENT' });
    await this.queue.enqueue({ jobId, kind: 'OPEN_PR' });
  }

  private async handleOpenPr(jobId: string): Promise<void> {
    const { job, installation, ref } = await this.context(jobId);
    const ghId = this.ghId(installation);
    const branchName =
      job.branchName ?? branchNameFor(this.config.get('BRANCH_PREFIX'), job.issueNumber);
    const base = await this.github.getDefaultBranch(ref);
    const headSha = await this.workspace.push({
      jobId,
      installationId: ghId,
      owner: job.repoOwner,
      repo: job.repoName,
      branchName,
      baseBranch: base,
    });
    await this.jobs.update(jobId, { headSha });

    const lastReview = await this.prisma.reviewPass.findFirst({
      where: { jobId },
      orderBy: { passNumber: 'desc' },
    });
    const meets =
      !!lastReview &&
      lastReview.verdict === 'PASS' &&
      lastReview.confidence >= this.review.threshold;
    const unresolved = lastReview ? formatIssues(JSON.parse(lastReview.issues)) : undefined;
    const plan = await this.approvedPlan(jobId);

    if (!job.prNumber) {
      const body = buildPrBody({
        issueNumber: job.issueNumber,
        plan,
        confidence: lastReview?.confidence ?? null,
        threshold: this.review.threshold,
        meetsThreshold: meets,
        unresolvedIssues: unresolved,
      });
      const pr = await this.github.createDraftPullRequest(ref, {
        title: `[Hermes] ${job.issueTitle}`.slice(0, 250),
        head: branchName,
        base,
        body,
      });
      await this.prisma.pullRequestRef.create({
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
      await this.prisma.pullRequestRef.updateMany({ where: { jobId }, data: { headSha } });
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
  ): Promise<{ job: Job; installation: RepoInstallation; ref: RepoRef }> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { installation: true },
    });
    if (!job) {
      throw new Error(`job ${jobId} not found`);
    }
    return { job, installation: job.installation, ref: this.refFor(job, job.installation) };
  }

  private refFor(job: Job, installation: RepoInstallation): RepoRef {
    return {
      installationId: Number(installation.installationId),
      owner: job.repoOwner,
      repo: job.repoName,
    };
  }

  private ghId(installation: RepoInstallation): number {
    return Number(installation.installationId);
  }

  private ghIdFromRef(ref: RepoRef): number {
    return ref.installationId;
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

  private renderPlanComment(plan: string): string {
    const prefix = this.config.get('COMMAND_PREFIX');
    return [
      `### Hermes implementation plan`,
      ``,
      plan,
      ``,
      `---`,
      `Reply with **\`${prefix} approve\`** to start implementation, or leave a comment with corrections to iterate. (\`${prefix} cancel\` to stop, \`${prefix} status\` to check progress.)`,
    ].join('\n');
  }

  private async safeComment(ref: RepoRef, issueOrPr: number, body: string): Promise<void> {
    try {
      await this.github.createIssueComment(ref, issueOrPr, body);
    } catch (e) {
      this.logger.warn(`failed to post comment: ${(e as Error).message}`);
    }
  }

  private async safeReaction(
    ref: RepoRef,
    issueNumber: number,
    content: Parameters<GithubService['createIssueReaction']>[2],
  ): Promise<void> {
    try {
      await this.github.createIssueReaction(ref, issueNumber, content);
    } catch (e) {
      this.logger.warn(`failed to add reaction: ${(e as Error).message}`);
    }
  }
}
