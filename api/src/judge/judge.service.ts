import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { HermesAgentService } from '../agent/agent.service.js';
import { buildJudgePrompt } from './judge.prompts.js';
import { parseJudgeVerdict } from './judge.utility.js';
import {
  JUDGE_TIMEOUT_MS,
  type JudgeAssessInput,
  type JudgementDto,
  type JudgeVerdict,
} from './judge.model.js';

/**
 * The completion judge — Hermes' `/goal` pattern, orchestrated by us. After an
 * IMPLEMENT/REVISE pass it asks an auxiliary/review-grade model whether the pass actually
 * satisfied the goal (acceptance criteria / issues). A "not met" verdict carries a concrete
 * critique that becomes the next pass's to-do list, so the agent resumes targeting the gaps
 * instead of re-orienting from scratch.
 */
@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(
    private readonly agent: HermesAgentService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async assess(input: JudgeAssessInput): Promise<JudgeVerdict> {
    const prompt = buildJudgePrompt(input);

    // Judge → review → primary model fallback (a weak auxiliary model makes an unreliable judge).
    const { model, provider } = this.config.judgeModel();

    const res = await this.agent.run({
      jobId: input.jobId,
      phase: 'JUDGE',
      cwd: input.cwd,
      prompt,
      timeoutMs: JUDGE_TIMEOUT_MS,
      model,
      provider,
    });

    const parsed = parseJudgeVerdict(res.stdout);

    // Fail open: an unparseable/failed judge must not stall the pipeline — proceed (the
    // downstream VERIFY/REVIEW gates still apply), but record it so it's visible.
    const verdict: JudgeVerdict = parsed ?? { met: true, critique: '' };

    if (!parsed) {
      this.logger.warn(
        `[job ${input.jobId}] judge produced no parseable verdict (${input.phase} attempt ${input.attempt}); treating as met`,
      );
    }

    // Record the pass/fail verdict on the run for the UI badge. The critique itself stays in
    // stdout (the run's output), like every other agent run. Best-effort: a write failure is a
    // UI-only loss and must never fail the run.
    try {
      await this.prisma.agentRun.update({
        where: { id: res.runId },
        data: { judgeMet: verdict.met },
      });
    } catch (e) {
      this.logger.warn(
        `[job ${input.jobId}] could not persist judge verdict: ${(e as Error).message}`,
      );
    }

    return verdict;
  }

  /** All judge evaluations for a job, newest first. */
  async listForJob(jobId: string): Promise<JudgementDto[]> {
    const rows = await this.prisma.agentRun.findMany({
      where: { jobId, phase: 'JUDGE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, stdout: true, judgeMet: true, createdAt: true },
    });

    return rows.map((r) => this.toJudgement(r));
  }

  /** A single judge evaluation — backs the dedicated critique page. */
  async getForJob(id: string): Promise<JudgementDto | null> {
    const r = await this.prisma.agentRun.findFirst({
      where: { id, phase: 'JUDGE' },
      select: { id: true, stdout: true, judgeMet: true, createdAt: true },
    });

    return r ? this.toJudgement(r) : null;
  }

  private toJudgement(r: {
    id: string;
    stdout: string | null;
    judgeMet: boolean | null;
    createdAt: Date;
  }): JudgementDto {
    const verdict = parseJudgeVerdict(r.stdout ?? '');
    return {
      id: r.id,
      met: r.judgeMet,
      // The clean critique parsed from the run's output; fall back to raw stdout if unparseable.
      critique: verdict ? verdict.critique : (r.stdout ?? ''),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
