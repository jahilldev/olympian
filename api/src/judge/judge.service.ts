import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { HermesAgentService } from '../agent/agent.service.js';
import { STDOUT_CAP } from '../agent/agent.model.js';
import { buildJudgePrompt } from './judge.prompts.js';
import { judgeMetFromStderr, parseJudgeVerdict } from './judge.utility.js';
import {
  JUDGE_MET_MARKER,
  JUDGE_TIMEOUT_MS,
  JUDGE_UNMET_MARKER,
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

    // Persist the verdict as a stderr marker so the runs list can show met/unmet with no
    // schema change. stdout (the full critique + reasoning) remains viewable via the run output.
    await this.prisma.agentRun.update({
      where: { id: res.runId },
      data: {
        stderr: `${res.stderr ?? ''}\n${verdict.met ? JUDGE_MET_MARKER : JUDGE_UNMET_MARKER}`.slice(
          -STDOUT_CAP,
        ),
      },
    });

    return verdict;
  }

  /** All judge evaluations for a job, newest first — powers the aggregated "Judge" card's View list. */
  async listForJob(jobId: string): Promise<JudgementDto[]> {
    const rows = await this.prisma.agentRun.findMany({
      where: { jobId, phase: 'JUDGE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, stdout: true, stderr: true, createdAt: true },
    });

    return rows.map((r) => {
      const verdict = parseJudgeVerdict(r.stdout ?? '');
      return {
        id: r.id,
        met: judgeMetFromStderr(r.stderr),
        // The clean critique from the verdict; fall back to raw output only if unparseable.
        critique: verdict ? verdict.critique : (r.stdout ?? ''),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
