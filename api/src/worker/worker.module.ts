import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module.js';
import { JobModule } from '../job/job.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { AgentModule } from '../agent/agent.module.js';
import { WorkerService } from './worker.service.js';

@Module({
  imports: [QueueModule, JobModule, OrchestratorModule, AgentModule],
  providers: [WorkerService],
})
export class WorkerModule {}
