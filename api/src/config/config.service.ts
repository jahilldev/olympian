import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env } from './config.model.js';
import { resolvePrivateKey } from './config.utility.js';

/**
 * Typed accessor over the validated environment. Inject this everywhere instead
 * of the raw `ConfigService` so consumers get compile-time-checked keys.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }

  /** Resolved GitHub App private key (inline or from file). Throws if missing. */
  get githubPrivateKey(): string {
    const key = resolvePrivateKey(
      this.get('GITHUB_APP_PRIVATE_KEY'),
      this.get('GITHUB_APP_PRIVATE_KEY_PATH'),
    );
    if (!key) {
      throw new Error(
        'GitHub App private key not configured: set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH.',
      );
    }
    return key;
  }
}
