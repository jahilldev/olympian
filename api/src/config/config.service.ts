import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODEL_ROLES, type Env, type ModelInfo } from './config.model.js';
import { resolvePrivateKey } from './config.utility.js';

/**
 * Typed accessor over the validated environment. Inject this everywhere instead
 * of the raw `ConfigService` so consumers get compile-time-checked keys.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {
    this.bridgeCustomApiKey();
  }

  /**
   * Hermes' `custom` provider (local / OpenAI-compatible inference servers) authenticates via the
   * standard `OPENAI_API_KEY` env var — there is no dedicated `custom` key in Hermes. So that users
   * pointing a role at `provider=custom` can supply a key under an unambiguous name rather than
   * overloading `OPENAI_API_KEY`, expose `CUSTOM_API_KEY` to Hermes under the name it actually
   * reads. Populating `process.env` covers both runtimes: the docker forward passes `OPENAI_API_KEY`
   * by name, and the SANDBOX_MODE=none subprocess inherits `process.env`. An explicitly set
   * `OPENAI_API_KEY` always wins (so a real OpenAI role is never clobbered).
   */
  private bridgeCustomApiKey(): void {
    const customKey = process.env.CUSTOM_API_KEY?.trim();

    if (customKey && !process.env.OPENAI_API_KEY?.trim()) {
      process.env.OPENAI_API_KEY = customKey;
    }
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }

  /**
   * Resolves the model/provider for the completion judge, falling back through the chain
   * judge → review → primary (each env var is optional). Returns undefined for a field only
   * when nothing in the chain is set, letting the agent runner apply its own default.
   */
  judgeModel(): { model?: string; provider?: string } {
    return {
      model:
        this.get('HERMES_JUDGE_MODEL') ||
        this.get('HERMES_REVIEW_MODEL') ||
        this.get('HERMES_PRIMARY_MODEL') ||
        undefined,
      provider:
        this.get('HERMES_JUDGE_PROVIDER') ||
        this.get('HERMES_REVIEW_PROVIDER') ||
        this.get('HERMES_PRIMARY_PROVIDER') ||
        undefined,
    };
  }

  /** The configured, selectable models — one per role whose model env var is set. */
  availableModels(): ModelInfo[] {
    return MODEL_ROLES.map(({ key, label, model, provider }) => ({
      key,
      label,
      model: (this.get(model) as string | undefined) || '',
      provider: (this.get(provider) as string | undefined) || null,
    })).filter((m) => m.model.length > 0);
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
