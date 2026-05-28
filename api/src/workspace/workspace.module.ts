import { Module } from '@nestjs/common';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { WorkspaceService } from './workspace.service.js';

@Module({
  imports: [GithubAppModule],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
