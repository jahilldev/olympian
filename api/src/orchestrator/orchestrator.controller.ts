import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';
import { CreateDashboardJobDto, FeedbackBodyDto, SetRepoDto } from './orchestrator.model.js';

/**
 * Operator actions from the dashboard, mirroring the `/hermes` issue commands and
 * driving dashboard-origin jobs (create, plan approve/feedback, accept/request-changes,
 * repo, diff). Lives in the orchestrator module (which owns OrchestratorService); the
 * read-only job views stay in JobController.
 */
@Controller('jobs')
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post()
  @HttpCode(201)
  createJob(@Body() body: CreateDashboardJobDto): Promise<{ id: string }> {
    return this.orchestrator.createDashboardJob({
      title: body.title,
      requirements: body.requirements,
      repoUrl: body.repoUrl,
    });
  }

  @Post(':id/cancel')
  @HttpCode(202)
  async cancel(@Param('id') id: string): Promise<{ ok: true }> {
    await this.orchestrator.cancelJob(id, 'the dashboard');

    return { ok: true };
  }

  @Post(':id/retry')
  @HttpCode(202)
  async retry(@Param('id') id: string): Promise<{ ok: true; kind?: string }> {
    const result = await this.orchestrator.retryJob(id, 'the dashboard');

    if (!result.retried) {
      throw new ConflictException(result.reason ?? 'job cannot be retried');
    }

    return { ok: true, kind: result.kind };
  }

  @Post(':id/plan/approve')
  @HttpCode(202)
  async approvePlan(@Param('id') id: string): Promise<{ ok: true }> {
    const result = await this.orchestrator.approvePlan(id, 'the dashboard');

    if (!result.approved) {
      throw new ConflictException(result.reason ?? 'plan cannot be approved');
    }

    return { ok: true };
  }

  @Post(':id/plan/feedback')
  @HttpCode(202)
  async planFeedback(
    @Param('id') id: string,
    @Body() body: FeedbackBodyDto,
  ): Promise<{ ok: true }> {
    const result = await this.orchestrator.submitPlanFeedback(id, 'dashboard', body.body);

    if (!result.ok) {
      throw new ConflictException(result.reason ?? 'feedback cannot be submitted');
    }

    return { ok: true };
  }

  @Post(':id/accept')
  @HttpCode(202)
  async accept(@Param('id') id: string): Promise<{ ok: true }> {
    const result = await this.orchestrator.acceptResult(id, 'the dashboard');

    if (!result.ok) {
      throw new ConflictException(result.reason ?? 'result cannot be accepted');
    }

    return { ok: true };
  }

  @Post(':id/changes')
  @HttpCode(202)
  async requestChanges(
    @Param('id') id: string,
    @Body() body: FeedbackBodyDto,
  ): Promise<{ ok: true }> {
    const result = await this.orchestrator.requestChanges(id, 'dashboard', body.body);

    if (!result.ok) {
      throw new ConflictException(result.reason ?? 'changes cannot be requested');
    }

    return { ok: true };
  }

  @Patch(':id/repo')
  @HttpCode(200)
  async setRepo(@Param('id') id: string, @Body() body: SetRepoDto): Promise<{ ok: true }> {
    const result = await this.orchestrator.setRepo(id, body.repoUrl?.trim() || null);

    if (!result.ok) {
      throw new ConflictException(result.reason ?? 'repo cannot be changed');
    }

    return { ok: true };
  }

  @Get(':id/diff')
  @Header('Cache-Control', 'no-store')
  getDiff(@Param('id') id: string): Promise<{ diff: string }> {
    return this.orchestrator.diff(id);
  }
}
