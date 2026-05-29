import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

@Module({
  imports: [GithubModule, OrchestratorModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
