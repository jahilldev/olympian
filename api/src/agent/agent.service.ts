import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import {
  STDOUT_CAP,
  type AgentRunDto,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentRunOutputDto,
} from './agent.model.js';
import {
  buildAgentSpec,
  spawnProcess,
  prepareHermesMemoryPaths,
  generateHermesConfig,
} from './agent.utility.js';
import { LangfuseService } from '../langfuse/langfuse.service.js';

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

  killOrphanedContainers(): void {
    if (this.config.get('SANDBOX_MODE') !== 'default') {
      return;
    }
    const list = spawn('docker', ['ps', '-q', '--filter', 'name=olympian-'], {
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
      this.logger.warn(
        `Killing ${containerIds.length} orphaned container(s): ${containerIds.join(', ')}`,
      );
      spawn('docker', ['rm', '-f', ...containerIds], { stdio: 'ignore' }).unref();
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
    const imageArg = this.config.get('DOCKER_AGENT_IMAGE');
    const imageIdx = spec.args.indexOf(imageArg);

    if (imageIdx > -1) {
      spec.args.splice(imageIdx, 0, '--env', `OTEL_RESOURCE_ATTRIBUTES=${sessionAttr}`);

      // Tell the persist_state plugin which phase this is, so it only maintains
      // .olympian/PROGRESS.md for IMPLEMENT/REVISE and never lets a REVIEW/VERIFY/JUDGE agent
      // (which share the same workspace) write over the working memory.
      spec.args.splice(imageIdx, 0, '--env', `OLYMPIAN_PHASE=${opts.phase}`);
    } else if (spec.env) {
      const env = spec.env as Record<string, string>;
      const existing = env.OTEL_RESOURCE_ATTRIBUTES;

      env.OTEL_RESOURCE_ATTRIBUTES = existing ? `${existing},${sessionAttr}` : sessionAttr;
      env.OLYMPIAN_PHASE = opts.phase;
    }

    this.logger.log(`[job ${opts.jobId}] agent ${opts.phase} starting: ${commandLine}`);

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

    const stderr = validationError ? `${raw.stderr}\n[incomplete] ${validationError}` : raw.stderr;

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

    this.langfuse.complete(run.id);
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
