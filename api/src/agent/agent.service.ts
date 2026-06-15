import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import {
  type AgentRunDto,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentRunOutputDto,
} from './agent.model.js';
import { buildSpawnSpec, spawnProcess, prepareHermesMemoryPaths } from './agent.utility.js';
import { LangfuseService } from '../langfuse/langfuse.service.js';

/**
 * Drives the Hermes Agent CLI. Each call runs `hermes -z --yolo --accept-hooks …` headless in the
 * job's worktree with the prompt piped over stdin, captures the result, and records
 * an AgentRun audit row. The orchestrator owns git, so this never commits.
 */
@Injectable()
export class HermesAgentService {
  private readonly logger = new Logger(HermesAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly langfuse: LangfuseService,
  ) {}

  /**
   * Force-removes all olympian-* Docker containers left over from a previous
   * process. Called on worker startup before tasks are reclaimed so the workspace
   * directory is never accessed by two containers simultaneously.
   */
  /**
   * Force-removes the running container for the given job, if any.
   * Called immediately when a cancel command is received so the agent stops
   * without waiting for the timeout.
   */
  killContainerForJob(jobId: string): void {
    if (this.config.get('SANDBOX_MODE') !== 'docker') {
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
    if (this.config.get('SANDBOX_MODE') !== 'docker') {
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

    if (sandboxMode === 'docker' && hermesHome) {
      prepareHermesMemoryPaths(hermesHome);
    }

    const spec = buildSpawnSpec({
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
      jobId: opts.jobId,
      publishPorts: opts.phase === 'REVIEW' && !!process.env.CAMOFOX_URL,
    });

    const commandLine = `${spec.command} ${spec.args.join(' ')}`;

    const run = await this.prisma.agentRun.create({
      data: {
        jobId: opts.jobId,
        phase: opts.phase,
        command: commandLine,
        cwd: opts.cwd,
        model,
        status: 'RUNNING',
      },
    });

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
    } else if (spec.env) {
      const env = spec.env as Record<string, string>;
      const existing = env.OTEL_RESOURCE_ATTRIBUTES;
      env.OTEL_RESOURCE_ATTRIBUTES = existing ? `${existing},${sessionAttr}` : sessionAttr;
    }

    this.logger.log(`[job ${opts.jobId}] agent ${opts.phase} starting: ${commandLine}`);

    const raw = await spawnProcess(spec, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? this.config.get('HERMES_TIMEOUT_MS'),
    });

    const status: AgentRunStatus = raw.timedOut
      ? 'TIMED_OUT'
      : raw.exitCode === 0
        ? 'SUCCEEDED'
        : 'FAILED';

    await this.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status,
        exitCode: raw.exitCode,
        stdout: raw.stdout,
        stderr: raw.stderr,
        durationMs: raw.durationMs,
      },
    });

    this.langfuse.complete(run.id);
    this.metrics.recordAgentRun(opts.phase, status, raw.durationMs);

    this.logger.log(
      `[job ${opts.jobId}] agent ${opts.phase} ${status} in ${raw.durationMs}ms (exit ${raw.exitCode})`,
    );

    return {
      runId: run.id,
      status,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      durationMs: raw.durationMs,
    };
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
