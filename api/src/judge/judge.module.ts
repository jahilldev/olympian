import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AgentModule } from '../agent/agent.module.js';
import { JudgeService } from './judge.service.js';

@Module({
  imports: [PrismaModule, AgentModule],
  providers: [JudgeService],
  exports: [JudgeService],
})
export class JudgeModule {}
