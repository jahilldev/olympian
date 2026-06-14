import { Controller, Get, Header, Param } from '@nestjs/common';
import { HermesAgentService } from '../agent/agent.service.js';
import { type AgentRunDto } from '../agent/agent.model.js';
import { ReviewService } from '../review/review.service.js';
import { type ReviewPassDto } from '../review/review.model.js';
import { type JobDetailDto, type JobSummaryDto } from './job.model.js';
import { JobService } from './job.service.js';

@Controller('jobs')
export class JobController {
  constructor(
    private readonly jobs: JobService,
    private readonly reviews: ReviewService,
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

  @Get(':id/runs')
  @Header('Cache-Control', 'no-store')
  listRuns(@Param('id') id: string): Promise<AgentRunDto[]> {
    return this.agent.listForJob(id);
  }
}
