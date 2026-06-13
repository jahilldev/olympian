import { Module } from '@nestjs/common';
import { LangfuseController } from './langfuse.controller.js';
import { LangfuseService } from './langfuse.service.js';

@Module({
  controllers: [LangfuseController],
  providers: [LangfuseService],
  exports: [LangfuseService],
})
export class LangfuseModule {}
