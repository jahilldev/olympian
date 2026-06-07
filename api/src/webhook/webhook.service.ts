import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { GithubService } from '../github/github.service.js';
import { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import {
  type InstallationPayload,
  type IssueCommentPayload,
  type IssuesPayload,
  type PullRequestReviewPayload,
} from './webhook.model.js';
import { isBotUser } from './webhook.utility.js';

/**
 * Routes verified GitHub webhook deliveries to the orchestrator. Deliveries are
 * recorded for idempotency: a redelivery is skipped only once the original was
 * fully processed (processedAt set), so a mid-processing crash is safely retried.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly app: GithubService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async handle(
    event: string,
    deliveryId: string,
    rawBody: string,
    payload: unknown,
  ): Promise<void> {
    const action = (payload as { action?: string }).action;
    this.metrics.recordWebhook(event, action);

    const existing = await this.prisma.webhookEvent.findUnique({ where: { deliveryId } });
    if (existing?.processedAt) {
      this.logger.debug(`Duplicate delivery ${deliveryId} already processed; skipping`);
      return;
    }
    if (!existing) {
      await this.prisma.webhookEvent.create({
        data: { deliveryId, event, action, payload: rawBody },
      });
    }

    await this.route(event, payload);

    await this.prisma.webhookEvent.update({
      where: { deliveryId },
      data: { processedAt: new Date() },
    });
  }

  private async route(event: string, payload: unknown): Promise<void> {
    switch (event) {
      case 'issues':
        return this.onIssues(payload as IssuesPayload);
      case 'issue_comment':
        return this.onIssueComment(payload as IssueCommentPayload);
      case 'pull_request_review':
        return this.onPullRequestReview(payload as PullRequestReviewPayload);
      case 'installation':
        return this.onInstallation(payload as InstallationPayload);
      default:
        this.logger.debug(`Ignoring unhandled event: ${event}`);
    }
  }

  private async onIssues(p: IssuesPayload): Promise<void> {
    if (p.action !== 'labeled' || !p.label || !p.installation) {
      return;
    }
    await this.orchestrator.onIssueLabeled({
      installationId: p.installation.id,
      accountLogin: p.repository.owner.login,
      accountType: p.repository.owner.type,
      owner: p.repository.owner.login,
      repo: p.repository.name,
      issueNumber: p.issue.number,
      issueTitle: p.issue.title,
      issueBody: p.issue.body ?? '',
      label: p.label.name,
    });
  }

  private async onIssueComment(p: IssueCommentPayload): Promise<void> {
    if (p.action !== 'created' || !p.installation) {
      return;
    }
    await this.orchestrator.onIssueComment({
      installationId: p.installation.id,
      owner: p.repository.owner.login,
      repo: p.repository.name,
      issueNumber: p.issue.number,
      commentId: p.comment.id,
      author: p.comment.user.login,
      body: p.comment.body,
      isBot: isBotUser(p.comment.user.type),
    });
  }

  private async onPullRequestReview(p: PullRequestReviewPayload): Promise<void> {
    if (p.action !== 'submitted' || !p.installation) {
      return;
    }
    const state = p.review.state.toLowerCase();
    if (state !== 'approved' && state !== 'changes_requested') {
      return;
    }
    await this.orchestrator.onPullRequestReview({
      installationId: p.installation.id,
      owner: p.repository.owner.login,
      repo: p.repository.name,
      prNumber: p.pull_request.number,
      state,
      author: p.review.user.login,
      isBot: isBotUser(p.review.user.type),
    });
  }

  private async onInstallation(p: InstallationPayload): Promise<void> {
    const suspended = p.action === 'suspend' || p.action === 'deleted';
    const installationId = BigInt(p.installation.id);
    await this.prisma.repoInstallation.upsert({
      where: { installationId },
      create: {
        installationId,
        accountLogin: p.installation.account.login,
        accountType: p.installation.account.type,
        suspended,
      },
      update: { suspended },
    });
    this.app.evict(p.installation.id);
  }
}
