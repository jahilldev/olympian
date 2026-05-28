import { Injectable, Logger } from '@nestjs/common';
import { GithubAppService } from '../github-app/github-app.service.js';
import {
  type CreatedPr,
  type DraftPrInput,
  type PullRequestInfo,
  type RepoPermission,
  type RepoRef,
  type ReviewFeedback,
} from './github-api.model.js';

/**
 * All read/write operations against GitHub repos, scoped to an installation.
 * Thin wrapper over Octokit so the rest of the app never touches Octokit directly.
 */
@Injectable()
export class GithubApiService {
  private readonly logger = new Logger(GithubApiService.name);

  constructor(private readonly app: GithubAppService) {}

  private client(ref: RepoRef) {
    return this.app.installationOctokit(ref.installationId);
  }

  async createIssueComment(ref: RepoRef, issueNumber: number, body: string): Promise<number> {
    const { data } = await this.client(ref).rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: issueNumber,
      body,
    });
    return data.id;
  }

  /** Repo permission level of a user, used to authorize approve/iterate commands. */
  async getCollaboratorPermission(ref: RepoRef, username: string): Promise<RepoPermission> {
    try {
      const { data } = await this.client(ref).rest.repos.getCollaboratorPermissionLevel({
        owner: ref.owner,
        repo: ref.repo,
        username,
      });
      return data.permission as RepoPermission;
    } catch (e) {
      this.logger.warn(`permission lookup failed for ${username}: ${(e as Error).message}`);
      return 'none';
    }
  }

  async getDefaultBranch(ref: RepoRef): Promise<string> {
    const { data } = await this.client(ref).rest.repos.get({
      owner: ref.owner,
      repo: ref.repo,
    });
    return data.default_branch;
  }

  async createDraftPullRequest(ref: RepoRef, input: DraftPrInput): Promise<CreatedPr> {
    const { data } = await this.client(ref).rest.pulls.create({
      owner: ref.owner,
      repo: ref.repo,
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: true,
    });
    return { number: data.number, url: data.html_url, headSha: data.head.sha };
  }

  async getPullRequest(ref: RepoRef, prNumber: number): Promise<PullRequestInfo> {
    const { data } = await this.client(ref).rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: prNumber,
    });
    return {
      number: data.number,
      state: data.state as 'open' | 'closed',
      merged: data.merged,
      isDraft: data.draft ?? false,
      headSha: data.head.sha,
      url: data.html_url,
    };
  }

  /** Aggregates review bodies + inline review comments for a changes-requested loop. */
  async getReviewFeedback(ref: RepoRef, prNumber: number): Promise<ReviewFeedback[]> {
    const client = this.client(ref);
    const [reviews, comments] = await Promise.all([
      client.rest.pulls.listReviews({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: prNumber,
      }),
      client.rest.pulls.listReviewComments({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: prNumber,
      }),
    ]);

    const feedback: ReviewFeedback[] = [];
    for (const r of reviews.data) {
      if (r.body && r.body.trim().length > 0) {
        feedback.push({ author: r.user?.login ?? 'unknown', body: r.body });
      }
    }
    for (const c of comments.data) {
      feedback.push({
        author: c.user?.login ?? 'unknown',
        body: c.body,
        path: c.path,
        line: c.line ?? c.original_line ?? undefined,
      });
    }
    return feedback;
  }
}
