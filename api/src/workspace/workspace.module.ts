import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module.js';
import { WorkspaceService } from './workspace.service.js';

@Module({
  imports: [GithubModule],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
