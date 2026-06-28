import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import {
  STDOUT_CAP,
  EVENT_FLUSH_INTERVAL_MS,
  type AgentRunDto,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentRunOutputDto,
} from './agent.model.js';
import {
  buildAgentSpec,
  eventInsertRows,
  spawnProcess,
  prepareHermesMemoryPaths,
  generateHermesConfig,
} from './agent.utility.js';
import { LangfuseService } from '../langfuse/langfuse.service.js';
import { type LangfuseEvent } from '../langfuse/langfuse.model.js';

/**
 * Drives the Hermes Agent CLI. Each call runs `hermes -z --yolo --accept-hooks …` headless in the
 * job's worktree with the prompt piped over stdin, captures the result, and records
 * an AgentRun audit row. The orchestrator owns git, so this never commits.
 */
@Injectable()
export class HermesAgentService implements OnModuleInit {
  private readonly logger = new Logger(HermesAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly langfuse: LangfuseService,
  ) {}

  async onModuleInit(): Promise<void> {
    const hermesHomeRaw = this.config.get('HERMES_HOME') || undefined;
    const hermesHome = hermesHomeRaw ? resolve(hermesHomeRaw) : undefined;

    if (!hermesHome) {
      return;
    }

    await generateHermesConfig(hermesHome, {
      contextLength: this.config.get('HERMES_CONTEXT_LENGTH'),
      compressionThreshold: this.config.get('HERMES_COMPRESS_THRESHOLD'),
      baseUrl: this.config.get('HERMES_MODEL_BASE_URL'),
      model: this.config.get('HERMES_PRIMARY_MODEL') || undefined,
      provider: this.config.get('HERMES_PRIMARY_PROVIDER') || undefined,
      auxiliaryModel: this.config.get('HERMES_AUXILIARY_MODEL') || undefined,
      auxiliaryProvider: this.config.get('HERMES_AUXILIARY_PROVIDER') || undefined,
      sandboxMode: this.config.get('SANDBOX_MODE'),
    });
  }

  /**
   * Force-removes the running container for the given job, if any.
   * Called immediately when a cancel command is received so the agent stops
   * without waiting for the timeout.
   */
  killContainerForJob(jobId: string): void {
    if (this.config.get('SANDBOX_MODE') !== 'default') {
      return;
    }

    const list = spawn('docker', ['ps', '-q', '--filter', `label=olympian.job=${jobId}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let ids = '';

    list.stdout.on('data', (d: Buffer) => {
      ids += d.toString();
    });

    list.on('close', () => {
      const containerIds = ids
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      if (containerIds.length === 0) {
        return;
      }

      this.logger.log(
        `Killing container(s) for cancelled job ${jobId}: ${containerIds.join(', ')}`,
      );

      spawn('docker', ['rm', '-f', ...containerIds], { stdio: 'ignore' }).unref();
    });
  }

  /**
   * Force-remove any leftover agent containers from a previous process. Awaited on worker startup
   * BEFORE tasks are reclaimed/claimed, so a re-run for the same job can't race a still-running
   * orphan in the same workspace (the docker daemon keeps a container alive after the orchestrator
   * that spawned it dies). Resolves once the removal completes (or immediately when there's
   * nothing to kill / sandboxing is off). Best-effort — never rejects.
   */
  killOrphanedContainers(): Promise<void> {
    if (this.config.get('SANDBOX_MODE') !== 'default') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const list = spawn('docker', ['ps', '-q', '--filter', 'name=olympian-'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      let ids = '';

      list.stdout.on('data', (d: Buffer) => {
        ids += d.toString();
      });

      list.on('error', () => resolve());

      list.on('close', () => {
        const containerIds = ids
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);

        if (containerIds.length === 0) {
          resolve();

          return;
        }

        this.logger.warn(
          `Killing ${containerIds.length} orphaned container(s): ${containerIds.join(', ')}`,
        );

        const rm = spawn('docker', ['rm', '-f', ...containerIds], { stdio: 'ignore' });

        rm.on('error', () => resolve());
        rm.on('close', () => resolve());
      });
    });
  }

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const model = opts.model ?? this.config.get('HERMES_PRIMARY_MODEL') ?? undefined;
    const provider = opts.provider ?? this.config.get('HERMES_PRIMARY_PROVIDER') ?? undefined;
    const sandboxMode = this.config.get('SANDBOX_MODE');
    const hermesHomeRaw = this.config.get('HERMES_HOME') || undefined;

    // Resolve to absolute: docker run -v requires absolute bind-mount sources.
    const hermesHome = hermesHomeRaw ? resolve(hermesHomeRaw) : undefined;

    if (sandboxMode === 'default' && hermesHome) {
      prepareHermesMemoryPaths(hermesHome);
    }

    const spec = buildAgentSpec({
      sandboxMode,
      hermesBin: this.config.get('HERMES_BIN'),
      dockerImage: this.config.get('DOCKER_AGENT_IMAGE'),
      hermesHome,
      cwd: opts.cwd,
      prompt: opts.prompt,
      model,
      provider,
      toolsets: opts.toolsets,
      skills: opts.skills,
      jobId: opts.jobId ?? opts.sessionId,
      publishPorts: opts.phase === 'REVIEW' && !!process.env.CAMOFOX_URL,
    });

    const commandLine = `${spec.command} ${spec.args.join(' ')}`;

    const run = await this.prisma.agentRun.create({
      data: {
        jobId: opts.jobId ?? null,
        sessionId: opts.sessionId ?? null,
        phase: opts.phase,
        command: commandLine,
        cwd: opts.cwd,
        model,
        status: 'RUNNING',
      },
    });

    opts.onStart?.(run.id);

    // Inject the run ID as an OTLP resource attribute so the trace receiver can
    // correlate incoming spans to this specific AgentRun record.
    // OTEL_RESOURCE_ATTRIBUTES is read by the opentelemetry SDK at startup and
    // merged into every span's resource, making session.id=<runId> visible in
    // the binary protobuf payload without requiring any agent-side changes.
    const sessionAttr = `session.id=${run.id}`;

    // Read by the worker_guard plugin to cap the IMPLEMENT/REVISE primary's per-read line count.
    const primaryReadMaxLines = String(this.config.get('PRIMARY_READ_MAX_LINES'));
    const imageArg = this.config.get('DOCKER_AGENT_IMAGE');
    const imageIdx = spec.args.indexOf(imageArg);

    if (imageIdx > -1) {
      spec.args.splice(imageIdx, 0, '--env', `OTEL_RESOURCE_ATTRIBUTES=${sessionAttr}`);

      // Tell the persist_state plugin which phase this is, so it only maintains
      // .olympian/PROGRESS.md for IMPLEMENT/REVISE and never lets a REVIEW/VERIFY/JUDGE agent
      // (which share the same workspace) write over the working memory.
      spec.args.splice(imageIdx, 0, '--env', `OLYMPIAN_PHASE=${opts.phase}`);
      spec.args.splice(imageIdx, 0, '--env', `PRIMARY_READ_MAX_LINES=${primaryReadMaxLines}`);
    } else if (spec.env) {
      const env = spec.env as Record<string, string>;
      const existing = env.OTEL_RESOURCE_ATTRIBUTES;

      env.OTEL_RESOURCE_ATTRIBUTES = existing ? `${existing},${sessionAttr}` : sessionAttr;
      env.OLYMPIAN_PHASE = opts.phase;
      env.PRIMARY_READ_MAX_LINES = primaryReadMaxLines;
    }

    this.logger.log(`[job ${opts.jobId}] agent ${opts.phase} starting: ${commandLine}`);

    // Persist activity events to AgentEvent incrementally as they stream in (not just at
    // completion), so a crashed/killed run still leaves a full paper trail and a long run isn't
    // truncated by the in-memory display buffer cap. Ownerless utility runs (e.g. TITLE) surface
    // nowhere, so they skip persistence to avoid noise. Started before spawn to catch every span.
    const persist = opts.jobId || opts.sessionId ? this.startEventPersistence(run.id) : null;

    try {
      const raw = await spawnProcess(spec, {
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs ?? this.config.get('HERMES_TIMEOUT_MS'),
      });

      // A clean exit (code 0) is only a real success if the output also passes the
      // caller's validation — a turn that exits 0 but cut off early is a failed run.
      const validationError =
        raw.exitCode === 0 && !raw.timedOut && opts.validate ? opts.validate(raw.stdout) : null;

      const status: AgentRunStatus = raw.timedOut
        ? 'TIMED_OUT'
        : raw.exitCode === 0 && !validationError
          ? 'SUCCEEDED'
          : 'FAILED';

      const stderr = validationError
        ? `${raw.stderr}\n[incomplete] ${validationError}`
        : raw.stderr;

      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status,
          exitCode: raw.exitCode,
          stdout: raw.stdout,
          stderr,
          durationMs: raw.durationMs,
        },
      });

      this.metrics.recordAgentRun(opts.phase, status, raw.durationMs);

      this.logger.log(
        `[job ${opts.jobId}] agent ${opts.phase} ${status} in ${raw.durationMs}ms (exit ${raw.exitCode})${
          validationError ? ` — ${validationError}` : ''
        }`,
      );

      return {
        runId: run.id,
        status,
        exitCode: raw.exitCode,
        stdout: raw.stdout,
        stderr,
        durationMs: raw.durationMs,
      };
    } finally {
      // Drain any events buffered since the last flush, then end the live subject. Runs on every
      // exit path (including a thrown error) so the persister's timer/subscription never leak.
      if (persist) {
        await persist.stop();
      }

      this.langfuse.complete(run.id);
    }
  }

  /**
   * Persist the run's activity events (full bodies) to AgentEvent incrementally as they stream in,
   * so they survive a crash/restart and a long run keeps a complete paper trail (the in-memory
   * display buffer is capped and would otherwise drop the earliest events). Subscribes to the live
   * event stream and flushes pending events to the DB on a short interval; `stop()` drains the
   * remainder and waits for all writes to land. Best-effort throughout — a persistence failure
   * never fails the run. Call before `langfuse.complete()` tears down the subject.
   */
  private startEventPersistence(runId: string): { stop: () => Promise<void> } {
    const pending: LangfuseEvent[] = [];
    let seq = 0;
    // Serialise writes so batches land in order and `stop()` can await the whole chain. `seq` is
    // assigned synchronously at flush-time (call order), so concurrent ticks never collide.
    let chain: Promise<void> = Promise.resolve();

    const flush = (): void => {
      if (pending.length === 0) {
        return;
      }
      const batch = pending.splice(0, pending.length);
      const rows = eventInsertRows(runId, batch, seq);
      seq += batch.length;
      chain = chain.then(() =>
        this.prisma.agentEvent.createMany({ data: rows }).then(
          () => undefined,
          (e: unknown) =>
            this.logger.warn(`event persist failed for run ${runId}: ${(e as Error).message}`),
        ),
      );
    };

    const subscription = this.langfuse.observe(runId).subscribe((ev) => pending.push(ev));
    const timer = setInterval(flush, EVENT_FLUSH_INTERVAL_MS);
    timer.unref?.(); // never hold the process open on this timer alone

    return {
      stop: async () => {
        clearInterval(timer);
        subscription.unsubscribe();
        flush(); // queue the final batch
        await chain; // wait for every queued write to land
      },
    };
  }

  /**
   * Downgrades an already-recorded run to FAILED when a post-hoc check proves it didn't
   * really succeed — e.g. a clean-exiting turn that produced no file changes (rubbish /
   * narration instead of edits). The recorded status is the source of truth shown in the
   * UI; the success metric was already counted, so a rare downgrade leaves a small,
   * acceptable skew rather than silently mislabelling the run.
   */
  async markRunFailed(runId: string, reason: string): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { status: true, stderr: true },
    });

    if (!run || run.status === 'FAILED') {
      return;
    }

    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        stderr: `${run.stderr ?? ''}\n[failed] ${reason}`.slice(0, STDOUT_CAP),
      },
    });
  }

  async listForJob(jobId: string): Promise<AgentRunDto[]> {
    const rows = await this.prisma.agentRun.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phase: true,
        model: true,
        status: true,
        exitCode: true,
        durationMs: true,
        stdout: true,
        judgePassed: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      phase: r.phase as AgentRunDto['phase'],
      model: r.model,
      status: r.status as AgentRunDto['status'],
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      hasOutput: !!(r.stdout && r.stdout.length > 0),
      createdAt: r.createdAt.toISOString(),
      judgePassed: r.judgePassed,
    }));
  }

  async getRunOutput(runId: string): Promise<AgentRunOutputDto | null> {
    const row = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { stdout: true, stderr: true },
    });

    if (!row) {
      return null;
    }

    return { stdout: row.stdout ?? '', stderr: row.stderr };
  }
}
