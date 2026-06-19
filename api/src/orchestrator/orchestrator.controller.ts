import { ConflictException, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';

/**
 * Operator actions from the dashboard, mirroring the `/hermes` issue commands.
 * Lives in the orchestrator module (which owns OrchestratorService); the read-only
 * job views stay in JobController.
 */
@Controller('jobs')
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

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
}
