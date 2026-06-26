import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { LangfuseModule } from '../langfuse/langfuse.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AgentModule, WorkspaceModule, LangfuseModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
