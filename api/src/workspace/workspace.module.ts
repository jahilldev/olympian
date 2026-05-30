import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service.js';

@Module({
  imports: [],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
