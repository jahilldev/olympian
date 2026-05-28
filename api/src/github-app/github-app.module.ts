import { Module } from '@nestjs/common';
import { GithubAppService } from './github-app.service.js';

@Module({
  providers: [GithubAppService],
  exports: [GithubAppService],
})
export class GithubAppModule {}
