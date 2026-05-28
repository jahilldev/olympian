import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { type AgentRunOptions, type AgentRunResult, type AgentRunStatus } from './agent.model.js';
import { buildSpawnSpec, spawnProcess } from './agent.utility.js';

/**
 * Drives the Hermes Agent CLI. Each call runs `hermes -z --yolo …` headless in the
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

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const model = this.config.get('HERMES_MODEL') || undefined;
    const spec = buildSpawnSpec({
      sandboxMode: this.config.get('SANDBOX_MODE'),
      hermesBin: this.config.get('HERMES_BIN'),
      dockerImage: this.config.get('DOCKER_AGENT_IMAGE'),
      hermesHome: this.config.get('HERMES_HOME') || undefined,
      cwd: opts.cwd,
      maxTurns: this.config.get('HERMES_MAX_TURNS'),
      model,
      provider: this.config.get('HERMES_PROVIDER') || undefined,
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
      input: opts.prompt,
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
