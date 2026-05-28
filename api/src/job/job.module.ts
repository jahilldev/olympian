import { Module } from '@nestjs/common';
import { JobService } from './job.service.js';

@Module({
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}
