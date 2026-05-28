import { Module } from '@nestjs/common';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

@Module({
  imports: [GithubAppModule, OrchestratorModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
