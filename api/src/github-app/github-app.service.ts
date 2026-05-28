import { Injectable } from '@nestjs/common';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { AppConfigService } from '../config/config.service.js';

/**
 * Owns GitHub App authentication. Produces Octokit clients authenticated either
 * as the App itself (for app-level endpoints) or as a specific installation
 * (for repo operations). Per-installation clients are cached; Octokit's app auth
 * strategy refreshes the underlying installation token automatically.
 */
@Injectable()
export class GithubAppService {
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
}
