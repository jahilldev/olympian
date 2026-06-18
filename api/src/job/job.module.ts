import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { ReviewModule } from '../review/review.module.js';
import { VerifyModule } from '../verify/verify.module.js';
import { JobController } from './job.controller.js';
import { JobService } from './job.service.js';

@Module({
  imports: [ReviewModule, VerifyModule, AgentModule],
  controllers: [JobController],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}
