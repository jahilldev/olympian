import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { HermesAgentService } from '../agent/agent.service.js';
import { type AgentRunDto, type AgentRunOutputDto } from '../agent/agent.model.js';
import { ReviewService } from '../review/review.service.js';
import { type ReviewPassDto } from '../review/review.model.js';
import { VerifyService } from '../verify/verify.service.js';
import { type VerifyRunDto } from '../verify/verify.model.js';
import { JudgeService } from '../judge/judge.service.js';
import { type JudgementDto } from '../judge/judge.model.js';
import { type JobDetailDto, type JobSummaryDto } from './job.model.js';
import { JobService } from './job.service.js';

@Controller('jobs')
export class JobController {
  constructor(
    private readonly jobs: JobService,
    private readonly reviews: ReviewService,
    private readonly verifications: VerifyService,
    private readonly judge: JudgeService,
    private readonly agent: HermesAgentService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  listJobs(): Promise<JobSummaryDto[]> {
    return this.jobs.listForUi();
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  getJob(@Param('id') id: string): Promise<JobDetailDto> {
    return this.jobs.getDetailForUi(id);
  }

  @Get(':id/reviews')
  @Header('Cache-Control', 'no-store')
  listReviews(@Param('id') id: string): Promise<ReviewPassDto[]> {
    return this.reviews.listForJob(id);
  }

  @Get(':id/verifications')
  @Header('Cache-Control', 'no-store')
  listVerifications(@Param('id') id: string): Promise<VerifyRunDto[]> {
    return this.verifications.listForJob(id);
  }

  @Get(':id/verifications/:vid')
  @Header('Cache-Control', 'no-store')
  async getVerification(
    @Param('id') _id: string,
    @Param('vid') vid: string,
  ): Promise<VerifyRunDto> {
    const run = await this.verifications.get(vid);

    if (!run) {
      throw new NotFoundException(`Verification ${vid} not found`);
    }

    return run;
  }

  @Get(':id/judgements/:jid')
  @Header('Cache-Control', 'no-store')
  async getJudgement(@Param('id') _id: string, @Param('jid') jid: string): Promise<JudgementDto> {
    const judgement = await this.judge.getForJob(jid);

    if (!judgement) {
      throw new NotFoundException(`Judgement ${jid} not found`);
    }

    return judgement;
  }

  @Get(':id/runs')
  @Header('Cache-Control', 'no-store')
  listRuns(@Param('id') id: string): Promise<AgentRunDto[]> {
    return this.agent.listForJob(id);
  }

  @Get(':id/runs/:runId/output')
  @Header('Cache-Control', 'no-store')
  async getRunOutput(
    @Param('id') _id: string,
    @Param('runId') runId: string,
  ): Promise<AgentRunOutputDto> {
    const result = await this.agent.getRunOutput(runId);

    if (!result) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    return result;
  }
}
