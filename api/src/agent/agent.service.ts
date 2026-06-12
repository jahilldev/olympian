import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { type AgentRunOptions, type AgentRunResult, type AgentRunStatus } from './agent.model.js';
import { buildSpawnSpec, spawnProcess, prepareHermesMemoryPaths } from './agent.utility.js';

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
  ) {}

  /**
   * Force-removes all olympian-* Docker containers left over from a previous
   * process. Called on worker startup before tasks are reclaimed so the workspace
   * directory is never accessed by two containers simultaneously.
   */
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
    const hermesHome = this.config.get('HERMES_HOME') || undefined;

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

    this.logger.log(`[job ${opts.jobId}] agent ${opts.phase} starting: ${commandLine}`);

    const raw = await spawnProcess(spec, {
      cwd: opts.cwd,
      hardTimeoutMs: opts.timeoutMs ?? this.config.get('HERMES_TIMEOUT_MS'),
      idleTimeoutMs: opts.idleTimeoutMs ?? this.config.get('HERMES_IDLE_TIMEOUT_MS'),
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
}
