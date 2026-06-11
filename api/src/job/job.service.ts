import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { type CreateJobInput, type JobState, type TransitionOptions } from './job.model.js';
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
    if (!canTransition(from, to)) {
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
}
