import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import {
  type ActiveRunDto,
  type ActiveTaskDto,
  type CreateJobInput,
  type FeedbackDto,
  type JobDetailDto,
  type JobState,
  type JobSummaryDto,
  type PlanRevisionDto,
  type TransitionDto,
  type TransitionOptions,
} from './job.model.js';
import { canTransition, repoFullName } from './job.utility.js';

/**
 * Owns the Job lifecycle: creation, the validated state machine, the transition
 * audit log, and lifecycle queries. The single source of truth for job state.
 */
@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async create(input: CreateJobInput): Promise<Job> {
    const fullName = repoFullName(input.repoOwner, input.repoName);

    const job = await this.prisma.job.create({
      data: {
        installationId: input.installationId,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        repoFullName: fullName,
        issueNumber: input.issueNumber,
        issueTitle: input.issueTitle,
        issueBody: input.issueBody,
        triggerLabel: input.triggerLabel,
        state: 'TRIAGED',
        transitions: { create: { fromState: null, toState: 'TRIAGED', actor: 'SYSTEM' } },
      },
    });

    this.metrics.recordTransition(null, 'TRIAGED');
    this.logger.log(`Created job ${job.id} for ${fullName}#${input.issueNumber}`);

    return job;
  }

  findById(id: string): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { id } });
  }

  async getById(id: string): Promise<Job> {
    const job = await this.findById(id);

    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    return job;
  }

  findByRepoIssue(repoFull: string, issueNumber: number): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: { repoFullName_issueNumber: { repoFullName: repoFull, issueNumber } },
    });
  }

  /** Validated state transition with an audit record. Throws on an illegal move. */
  async transition(jobId: string, to: JobState, opts: TransitionOptions = {}): Promise<Job> {
    const job = await this.getById(jobId);
    const from = job.state as JobState;

    if (from === to) {
      return job;
    }

    if (!opts.force && !canTransition(from, to)) {
      throw new ConflictException(`Illegal job transition ${from} -> ${to} (job ${jobId})`);
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        state: to,
        transitions: {
          create: {
            fromState: from,
            toState: to,
            reason: opts.reason,
            actor: opts.actor ?? 'SYSTEM',
          },
        },
      },
    });

    this.metrics.recordTransition(from, to);
    this.logger.log(`Job ${jobId}: ${from} -> ${to}${opts.reason ? ` (${opts.reason})` : ''}`);

    return updated;
  }

  async fail(jobId: string, message: string, actor: 'AGENT' | 'SYSTEM' = 'SYSTEM'): Promise<Job> {
    await this.prisma.job.update({ where: { id: jobId }, data: { error: message } });

    return this.transition(jobId, 'FAILED', { reason: message.slice(0, 500), actor });
  }

  update(jobId: string, data: Prisma.JobUpdateInput): Promise<Job> {
    return this.prisma.job.update({ where: { id: jobId }, data });
  }

  async incrementAttempts(jobId: string): Promise<number> {
    const job = await this.prisma.job.update({
      where: { id: jobId },
      data: { attempts: { increment: 1 } },
    });

    return job.attempts;
  }

  /** Oldest not-yet-started job for a repo — used to pick up the next issue. */
  nextTriagedJob(repoFull: string): Promise<Job | null> {
    return this.prisma.job.findFirst({
      where: { repoFullName: repoFull, state: 'TRIAGED' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countsByState(): Promise<Record<string, number>> {
    const rows = await this.prisma.job.groupBy({ by: ['state'], _count: { _all: true } });

    return Object.fromEntries(rows.map((r) => [r.state, r._count._all]));
  }

  async listForUi(): Promise<JobSummaryDto[]> {
    const jobs = await this.prisma.job.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        runs: { where: { status: 'RUNNING' }, take: 1, orderBy: { createdAt: 'desc' } },
        tasks: { where: { status: 'RUNNING' }, take: 1, orderBy: { createdAt: 'desc' } },
        pr: true,
      },
    });

    return jobs.map((job) => {
      const activeRun = job.runs[0] ?? null;
      const activeTask = job.tasks[0] ?? null;
      return {
        id: job.id,
        repoFullName: job.repoFullName,
        issueNumber: job.issueNumber,
        issueTitle: job.issueTitle,
        state: job.state,
        confidence: job.confidence,
        reviewCycle: job.reviewCycle,
        prNumber: job.prNumber,
        prUrl: job.pr?.url ?? null,
        prIsDraft: job.pr?.isDraft ?? false,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        activeRun: activeRun
          ? {
              id: activeRun.id,
              phase: activeRun.phase,
              model: activeRun.model,
              createdAt: activeRun.createdAt.toISOString(),
            }
          : null,
        activeTask: activeTask
          ? { kind: activeTask.kind, status: activeTask.status, attempts: activeTask.attempts }
          : null,
      };
    });
  }

  async getDetailForUi(id: string): Promise<JobDetailDto> {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        transitions: { orderBy: { createdAt: 'asc' } },
        plans: { orderBy: { revision: 'asc' } },
        feedback: { orderBy: { createdAt: 'asc' } },
        prFeedback: { orderBy: { createdAt: 'asc' } },
        tasks: { where: { status: 'RUNNING' }, take: 1, orderBy: { createdAt: 'desc' } },
        runs: { where: { status: 'RUNNING' }, take: 1, orderBy: { createdAt: 'desc' } },
        pr: true,
      },
    });

    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    const activeRun = job.runs[0] ?? null;
    const activeTask = job.tasks[0] ?? null;

    const transitions: TransitionDto[] = job.transitions.map((t) => ({
      id: t.id,
      fromState: t.fromState,
      toState: t.toState,
      reason: t.reason,
      actor: t.actor,
      createdAt: t.createdAt.toISOString(),
    }));

    const plans: PlanRevisionDto[] = job.plans.map((p) => ({
      id: p.id,
      revision: p.revision,
      content: p.content,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    }));

    const toFeedback = (f: {
      id: string;
      author: string;
      body: string;
      createdAt: Date;
    }): FeedbackDto => ({
      id: f.id,
      author: f.author,
      body: f.body,
      createdAt: f.createdAt.toISOString(),
    });

    const toActiveRun = (r: typeof activeRun): ActiveRunDto | null =>
      r ? { id: r.id, phase: r.phase, model: r.model, createdAt: r.createdAt.toISOString() } : null;

    const toActiveTask = (t: typeof activeTask): ActiveTaskDto | null =>
      t ? { kind: t.kind, status: t.status, attempts: t.attempts } : null;

    return {
      id: job.id,
      repoFullName: job.repoFullName,
      issueNumber: job.issueNumber,
      issueTitle: job.issueTitle,
      issueBody: job.issueBody,
      state: job.state,
      confidence: job.confidence,
      reviewCycle: job.reviewCycle,
      prNumber: job.prNumber,
      prUrl: job.pr?.url ?? null,
      prIsDraft: job.pr?.isDraft ?? false,
      branchName: job.branchName,
      headSha: job.headSha,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      activeRun: toActiveRun(activeRun),
      activeTask: toActiveTask(activeTask),
      transitions,
      plans,
      planFeedback: job.feedback.map(toFeedback),
      prFeedback: job.prFeedback.map(toFeedback),
    };
  }
}
