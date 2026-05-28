import { Module } from '@nestjs/common';
import { HermesAgentService } from './agent.service.js';

@Module({
  providers: [HermesAgentService],
  exports: [HermesAgentService],
})
export class AgentModule {}
