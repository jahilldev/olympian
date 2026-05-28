import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module.js';
import { JobModule } from '../job/job.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { WorkerService } from './worker.service.js';

@Module({
  imports: [QueueModule, JobModule, OrchestratorModule],
  providers: [WorkerService],
})
export class WorkerModule {}
