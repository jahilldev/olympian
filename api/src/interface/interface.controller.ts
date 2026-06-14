import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type AgentRunDto,
  type FeedbackDto,
  type JobDetailDto,
  type JobSummaryDto,
  type ReviewIssueDto,
  type ReviewPassDto,
  type TransitionDto,
} from './interface.model.js';

@Controller('interface')
export class InterfaceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('jobs')
  @Header('Cache-Control', 'no-store')
  async listJobs(): Promise<JobSummaryDto[]> {
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
              phase: activeRun.phase as JobSummaryDto['activeRun'] extends null
                ? never
                : JobSummaryDto['activeRun']['phase'],
              model: activeRun.model,
              createdAt: activeRun.createdAt.toISOString(),
            }
          : null,
        activeTask: activeTask
          ? {
              kind: activeTask.kind as JobSummaryDto['activeTask'] extends null
                ? never
                : JobSummaryDto['activeTask']['kind'],
              status: activeTask.status as JobSummaryDto['activeTask'] extends null
                ? never
                : JobSummaryDto['activeTask']['status'],
              attempts: activeTask.attempts,
            }
          : null,
      };
    });
  }

  @Get('jobs/:id')
  @Header('Cache-Control', 'no-store')
  async getJob(@Param('id') id: string): Promise<JobDetailDto> {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        transitions: { orderBy: { createdAt: 'asc' } },
        plans: { orderBy: { revision: 'asc' } },
        feedback: { orderBy: { createdAt: 'asc' } },
        prFeedback: { orderBy: { createdAt: 'asc' } },
        reviews: { orderBy: [{ cycle: 'asc' }, { passNumber: 'asc' }] },
        runs: { orderBy: { createdAt: 'desc' } },
        tasks: { where: { status: 'RUNNING' }, take: 1, orderBy: { createdAt: 'desc' } },
        pr: true,
      },
    });

    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    const activeRun = job.runs.find((r) => r.status === 'RUNNING') ?? null;
    const activeTask = job.tasks[0] ?? null;

    const transitions: TransitionDto[] = job.transitions.map((t) => ({
      id: t.id,
      fromState: t.fromState,
      toState: t.toState,
      reason: t.reason,
      actor: t.actor,
      createdAt: t.createdAt.toISOString(),
    }));

    const reviewPasses: ReviewPassDto[] = job.reviews.map((r) => {
      let issues: ReviewIssueDto[] = [];
      try {
        issues = JSON.parse(r.issues) as ReviewIssueDto[];
      } catch {
        // malformed stored JSON — return empty array
      }
      return {
        id: r.id,
        cycle: r.cycle,
        passNumber: r.passNumber,
        confidence: r.confidence,
        verdict: r.verdict as ReviewPassDto['verdict'],
        issues,
        createdAt: r.createdAt.toISOString(),
      };
    });

    const runs: AgentRunDto[] = job.runs.map((r) => ({
      id: r.id,
      phase: r.phase as AgentRunDto['phase'],
      model: r.model,
      status: r.status,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      hasOutput: !!(r.stdout && r.stdout.length > 0),
      createdAt: r.createdAt.toISOString(),
    }));

    const prFeedback: FeedbackDto[] = job.prFeedback.map((f) => ({
      id: f.id,
      author: f.author,
      body: f.body,
      createdAt: f.createdAt.toISOString(),
    }));

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
      activeRun: activeRun
        ? {
            id: activeRun.id,
            phase: activeRun.phase as AgentRunDto['phase'],
            model: activeRun.model,
            createdAt: activeRun.createdAt.toISOString(),
          }
        : null,
      activeTask: activeTask
        ? {
            kind: activeTask.kind as JobSummaryDto['activeTask'] extends null
              ? never
              : JobSummaryDto['activeTask']['kind'],
            status: activeTask.status as JobSummaryDto['activeTask'] extends null
              ? never
              : JobSummaryDto['activeTask']['status'],
            attempts: activeTask.attempts,
          }
        : null,
      transitions,
      plans: job.plans.map((p) => ({
        id: p.id,
        revision: p.revision,
        content: p.content,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      planFeedback: job.feedback.map((f) => ({
        id: f.id,
        author: f.author,
        body: f.body,
        createdAt: f.createdAt.toISOString(),
      })),
      prFeedback,
      reviewPasses,
      runs,
    };
  }
}
