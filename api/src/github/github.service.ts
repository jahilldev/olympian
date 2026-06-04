import { Injectable, Logger } from '@nestjs/common';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { AppConfigService } from '../config/config.service.js';
import {
  type CreatedPr,
  type DraftPrInput,
  type PullRequestInfo,
  type RepoPermission,
  type RepoRef,
  type ReviewFeedback,
} from './github.model.js';

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly installationClients = new Map<number, Octokit>();
  private appClient?: Octokit;

  constructor(private readonly config: AppConfigService) {}

  private get appAuth() {
    return {
      appId: this.config.get('GITHUB_APP_ID'),
      privateKey: this.config.githubPrivateKey,
    };
  }

  /** Octokit authenticated as the App (JWT) — for installation discovery, etc. */
  appOctokit(): Octokit {
    if (!this.appClient) {
      this.appClient = new Octokit({
        authStrategy: createAppAuth,
        auth: this.appAuth,
      });
    }
    return this.appClient;
  }

  /** Octokit scoped to a single installation — for repo reads/writes. */
  installationOctokit(installationId: number): Octokit {
    const cached = this.installationClients.get(installationId);
    if (cached) {
      return cached;
    }
    const client = new Octokit({
      authStrategy: createAppAuth,
      auth: { ...this.appAuth, installationId },
    });
    this.installationClients.set(installationId, client);
    return client;
  }

  /**
   * Short-lived installation access token, for authenticating git remotes
   * (clone/push). Tokens expire ~1h, so callers should fetch one per push.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const auth = createAppAuth(this.appAuth);
    const result = await auth({ type: 'installation', installationId });
    return result.token;
  }

  /** Drop a cached client (e.g. on installation suspension/deletion). */
  evict(installationId: number): void {
    this.installationClients.delete(installationId);
  }

  private client(ref: RepoRef) {
    return this.installationOctokit(ref.installationId);
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

  async createIssueReaction(
    ref: RepoRef,
    issueNumber: number,
    content: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes',
  ): Promise<void> {
    await this.client(ref).rest.reactions.createForIssue({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: issueNumber,
      content,
    });
  }

  async createCommentReaction(
    ref: RepoRef,
    commentId: number,
    content: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes',
  ): Promise<void> {
    await this.client(ref).rest.reactions.createForIssueComment({
      owner: ref.owner,
      repo: ref.repo,
      comment_id: commentId,
      content,
    });
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
