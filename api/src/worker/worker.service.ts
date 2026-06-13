import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { type QueueTask } from '@prisma/client';
import { AppConfigService } from '../config/config.service.js';
import { QueueService } from '../queue/queue.service.js';
import { JobService } from '../job/job.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import { HermesAgentService } from '../agent/agent.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LangfuseService } from '../langfuse/langfuse.service.js';
import { WORKER_ID } from './worker.model.js';

/**
 * Polls the queue, claims up to the configured concurrency, and runs each task
 * through the orchestrator. Tasks run concurrently (fire-and-forget with inflight
 * accounting); failures are handed back to the queue for backoff/retry and, when
 * exhausted, escalated to the orchestrator to fail the job.
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private inflight = 0;
  private stopped = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfigService,
    private readonly queue: QueueService,
    private readonly jobs: JobService,
    private readonly metrics: MetricsService,
    private readonly orchestrator: OrchestratorService,
    private readonly agent: HermesAgentService,
    private readonly prisma: PrismaService,
    private readonly langfuse: LangfuseService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get('WORKER_ENABLED')) {
      this.logger.warn('Worker disabled (WORKER_ENABLED=false)');
      return;
    }
    this.agent.killOrphanedContainers();
    await this.queue.reclaimOrphaned();
    this.logger.log(
      `Worker ${WORKER_ID} starting (concurrency ${this.config.get('WORKER_CONCURRENCY')})`,
    );
    void this.loop();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private loop = async (): Promise<void> => {
    if (this.stopped) {
      return;
    }
    try {
      await this.tick();
    } catch (e) {
      this.logger.error(`worker tick failed: ${(e as Error).message}`);
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.loop(), this.config.get('WORKER_POLL_INTERVAL_MS'));
      }
    }
  };

  private async tick(): Promise<void> {
    await this.refreshMetrics();
    const exhausted = await this.queue.expireExhaustedStale();
    for (const task of exhausted) {
      await this.orchestrator
        .onTaskExhausted(task.jobId, task.lastError ?? 'stale lock with no retries remaining')
        .catch((err) =>
          this.logger.error(`failed to escalate exhausted stale task: ${(err as Error).message}`),
        );
    }

    // Kill agents that haven't sent telemetry in HERMES_IDLE_TIMEOUT_MS
    await this.killIdleAgents();

    const capacity = this.config.get('WORKER_CONCURRENCY') - this.inflight;
    if (capacity <= 0) {
      return;
    }
    const tasks = await this.queue.claimBatch(WORKER_ID, capacity);
    for (const task of tasks) {
      this.inflight += 1;
      void this.process(task).finally(() => {
        this.inflight -= 1;
      });
    }
  }

  private async process(task: QueueTask): Promise<void> {
    this.logger.log(`Processing task ${task.id} (${task.kind}) for job ${task.jobId}`);
    const heartbeatMs = Math.floor(this.config.get('QUEUE_LOCK_TTL_MS') / 3);
    const heartbeat = setInterval(
      () => void this.queue.refreshLock(task.id, WORKER_ID),
      heartbeatMs,
    );
    try {
      await this.orchestrator.processTask(task);
      await this.queue.complete(task.id);
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      const willRetry = await this.queue.fail(task.id, message);
      if (!willRetry) {
        await this.orchestrator
          .onTaskExhausted(task.jobId, message)
          .catch((err) =>
            this.logger.error(`failed to escalate exhausted task: ${(err as Error).message}`),
          );
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async refreshMetrics(): Promise<void> {
    const [jobCounts, queueCounts] = await Promise.all([
      this.jobs.countsByState(),
      this.queue.depthByStatus(),
    ]);
    this.metrics.setJobsByState(jobCounts);
    this.metrics.setQueueDepth(queueCounts);
  }

  /**
   * Kills agent containers that haven't sent telemetry in HERMES_IDLE_TIMEOUT_MS.
   * Catches hung tool calls, deadlocks, and infinite loops.
   */
  private async killIdleAgents(): Promise<void> {
    const idleTimeoutMs = this.config.get('HERMES_IDLE_TIMEOUT_MS');
    const idleSessions = this.langfuse.findIdleSessions(idleTimeoutMs);

    if (idleSessions.length === 0) {
      return;
    }

    const runs = await this.prisma.agentRun.findMany({
      where: { id: { in: idleSessions }, status: 'RUNNING' },
      select: { id: true, jobId: true, phase: true },
    });

    for (const run of runs) {
      const idleMinutes = Math.floor(idleTimeoutMs / 60_000);

      this.logger.warn(
        `Killing idle agent run ${run.id} (job ${run.jobId}, phase ${run.phase}) - no telemetry for ${idleMinutes} min`,
      );

      // Kill the Docker container. We search for olympian-* containers and inspect
      // each to find the one with OTEL_RESOURCE_ATTRIBUTES containing our run ID.
      if (this.config.get('SANDBOX_MODE') === 'docker') {
        const list = spawn('docker', ['ps', '-q', '--filter', 'name=olympian-'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        let containerIds = '';

        list.stdout.on('data', (d: Buffer) => {
          containerIds += d.toString();
        });

        list.on('close', () => {
          const ids = containerIds
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);

          for (const containerId of ids) {
            const inspect = spawn(
              'docker',
              ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', containerId],
              { stdio: ['ignore', 'pipe', 'ignore'] },
            );

            let envVars = '';

            inspect.stdout.on('data', (d: Buffer) => {
              envVars += d.toString();
            });

            inspect.on('close', () => {
              if (envVars.includes(`session.id=${run.id}`)) {
                this.logger.log(`Killing container ${containerId} for run ${run.id}`);
                spawn('docker', ['kill', containerId], { stdio: 'ignore' }).unref();
              }
            });
          }
        });
      }

      // Mark the run as TIMED_OUT
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'TIMED_OUT',
          exitCode: 124,
          stderr: `Killed by idle detection - no telemetry received for ${idleMinutes} minutes`,
        },
      });

      // Clean up the langfuse session
      this.langfuse.complete(run.id);
    }
  }
}
