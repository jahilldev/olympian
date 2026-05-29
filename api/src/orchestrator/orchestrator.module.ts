import { Module } from '@nestjs/common';
import { JobModule } from '../job/job.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { AgentModule } from '../agent/agent.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ReviewModule } from '../review/review.module.js';
import { GithubModule } from '../github/github.module.js';
import { OrchestratorService } from './orchestrator.service.js';

@Module({
  imports: [JobModule, QueueModule, AgentModule, WorkspaceModule, ReviewModule, GithubModule],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
