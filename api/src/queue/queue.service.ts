import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type QueueTask } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { type EnqueueInput, type TaskKind } from './queue.model.js';
import { backoffMs } from './queue.utility.js';

/**
 * File-backed work queue over SQLite. Tasks are claimed with a single atomic
 * `UPDATE ... RETURNING` (atomic in SQLite, so concurrent claimers never grab the
 * same row); orphaned RUNNING tasks past the lock TTL are reclaimable. Failed tasks
 * back off exponentially until maxAttempts, then settle as FAILED.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** Enqueue a task, skipping if an equivalent PENDING/RUNNING task already exists. */
  async enqueue(input: EnqueueInput): Promise<QueueTask> {
    const existing = await this.prisma.queueTask.findFirst({
      where: { jobId: input.jobId, kind: input.kind, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (existing) {
      this.logger.debug(`Skipping duplicate ${input.kind} task for job ${input.jobId}`);
      return existing;
    }
    return this.prisma.queueTask.create({
      data: {
        jobId: input.jobId,
        kind: input.kind,
        runAt: input.runAt ?? new Date(),
        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? this.config.get('QUEUE_MAX_ATTEMPTS'),
      },
    });
  }

  /**
   * Atomically claim up to `limit` due tasks for this worker. Increments attempts
   * and marks RUNNING in the same statement so a crash leaves a reclaimable lock.
   */
  async claimBatch(workerId: string, limit: number): Promise<QueueTask[]> {
    if (limit <= 0) {
      return [];
    }
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.config.get('QUEUE_LOCK_TTL_MS'));

    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "QueueTask"
      SET "status" = 'RUNNING',
          "lockedAt" = ${now},
          "lockedBy" = ${workerId},
          "attempts" = "attempts" + 1,
          "updatedAt" = ${now}
      WHERE "id" IN (
        SELECT "id" FROM "QueueTask"
        WHERE (
              ("status" = 'PENDING' AND "runAt" <= ${now})
           OR ("status" = 'RUNNING' AND "lockedAt" IS NOT NULL AND "lockedAt" < ${staleBefore})
        )
        -- Never run two tasks for the same job concurrently: skip any job that
        -- already has a healthy (non-stale) RUNNING task. This keeps each job's
        -- workspace directory owned by exactly one worker at a time.
        AND "jobId" NOT IN (
          SELECT "jobId" FROM "QueueTask"
          WHERE "status" = 'RUNNING' AND ("lockedAt" IS NULL OR "lockedAt" >= ${staleBefore})
        )
        ORDER BY "priority" DESC, "runAt" ASC
        LIMIT ${limit}
      )
      RETURNING "id";
    `);

    if (claimed.length === 0) {
      return [];
    }
    const ids = claimed.map((r) => r.id);
    // Re-read through the typed client so callers get proper field types.
    return this.prisma.queueTask.findMany({ where: { id: { in: ids } } });
  }

  async complete(taskId: string): Promise<void> {
    await this.prisma.queueTask.update({
      where: { id: taskId },
      data: { status: 'DONE', lockedAt: null, lockedBy: null },
    });
  }

  /**
   * Mark a task failed. Retries with exponential backoff while attempts remain;
   * otherwise settles as FAILED. Returns true if it will be retried.
   */
  async fail(taskId: string, error: string): Promise<boolean> {
    const task = await this.prisma.queueTask.findUnique({ where: { id: taskId } });
    if (!task) {
      return false;
    }
    const willRetry = task.attempts < task.maxAttempts;
    if (willRetry) {
      const delay = backoffMs(task.attempts, this.config.get('QUEUE_BACKOFF_BASE_MS'));
      await this.prisma.queueTask.update({
        where: { id: taskId },
        data: {
          status: 'PENDING',
          runAt: new Date(Date.now() + delay),
          lockedAt: null,
          lockedBy: null,
          lastError: error.slice(0, 2000),
        },
      });
      this.logger.warn(
        `Task ${taskId} (${task.kind}) failed; retry ${task.attempts}/${task.maxAttempts} in ${delay}ms`,
      );
    } else {
      await this.prisma.queueTask.update({
        where: { id: taskId },
        data: { status: 'FAILED', lockedAt: null, lockedBy: null, lastError: error.slice(0, 2000) },
      });
      this.logger.error(
        `Task ${taskId} (${task.kind}) failed permanently after ${task.attempts} attempts`,
      );
    }
    return willRetry;
  }

  /** Cancel all outstanding (PENDING/RUNNING) tasks for a job. */
  async cancelForJob(jobId: string): Promise<void> {
    await this.prisma.queueTask.updateMany({
      where: { jobId, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'FAILED', lastError: 'cancelled' },
    });
  }

  async depthByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.queueTask.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  countPending(kind?: TaskKind): Promise<number> {
    return this.prisma.queueTask.count({
      where: { status: 'PENDING', ...(kind ? { kind } : {}) },
    });
  }
}
