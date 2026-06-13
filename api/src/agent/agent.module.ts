import { Module } from '@nestjs/common';
import { LangfuseModule } from '../langfuse/langfuse.module.js';
import { HermesAgentService } from './agent.service.js';

@Module({
  imports: [LangfuseModule],
  providers: [HermesAgentService],
  exports: [HermesAgentService],
})
export class AgentModule {}
