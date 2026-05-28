import { Module } from '@nestjs/common';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { GithubApiService } from './github-api.service.js';

@Module({
  imports: [GithubAppModule],
  providers: [GithubApiService],
  exports: [GithubApiService],
})
export class GithubApiModule {}
