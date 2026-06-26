import { z } from 'zod';

const booleanFromString = z.preprocess(
  (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' || v === '1' : v),
  z.boolean(),
);

const intFromString = (def: number) => z.coerce.number().int().default(def);

export const envSchema = z.object({
  // server
  PORT: z.coerce.number().int().default(3030),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // database
  DATABASE_URL: z.string().min(1),

  // github app
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),

  // hermes
  HERMES_BIN: z.string().default('hermes'),
  HERMES_HOME: z.string().optional(),
  HERMES_PRIMARY_MODEL: z.string().optional(),
  HERMES_PRIMARY_PROVIDER: z.string().optional(),
  HERMES_REVIEW_MODEL: z.string().optional(),
  HERMES_REVIEW_PROVIDER: z.string().optional(),
  HERMES_AUXILIARY_MODEL: z.string().optional(),
  HERMES_AUXILIARY_PROVIDER: z.string().optional(),
  // Completion judge model — defaults to the review model (a weak aux model makes an
  // unreliable judge). Provider falls back the same way.
  HERMES_JUDGE_MODEL: z.string().optional(),
  HERMES_JUDGE_PROVIDER: z.string().optional(),
  HERMES_TIMEOUT_MS: intFromString(7_200_000),
  HERMES_CONTEXT_LENGTH: z.coerce.number().int().optional(),
  HERMES_COMPRESS_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
  HERMES_MODEL_BASE_URL: z.string().optional(),
  // Diagnostic: log a compact identity line for every incoming trace span so the
  // exact shape of auxiliary/compression events can be inspected. Off by default.
  LANGFUSE_DEBUG_SPANS: booleanFromString.default(false),

  // orchestration policy
  TRIGGER_LABEL: z.string().default('hermes'),
  REVIEW_CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(85),
  MAX_PLAN_REVISIONS: intFromString(10),
  // Max VERIFY→REVISE iterations per cycle before opening a draft PR with tests still red.
  MAX_VERIFY_ATTEMPTS: intFromString(3),
  // Max completion-judge continuations per IMPLEMENT/REVISE pass before proceeding to VERIFY
  // anyway. 0 disables the judge loop entirely.
  MAX_COMPLETION_RETRIES: intFromString(2),
  MAX_REVIEW_PASSES: intFromString(5),
  COMMAND_PREFIX: z.string().default('/hermes'),

  // queue / worker
  WORKER_ENABLED: booleanFromString.default(true),
  WORKER_CONCURRENCY: intFromString(2),
  WORKER_POLL_INTERVAL_MS: intFromString(2000),
  QUEUE_MAX_ATTEMPTS: intFromString(3),
  QUEUE_BACKOFF_BASE_MS: intFromString(15_000),
  QUEUE_LOCK_TTL_MS: intFromString(3_600_000),

  // workspace / git
  WORKSPACE_ROOT: z.string().default('./.workspaces'),
  GIT_AUTHOR_NAME: z.string().default('Hermes Agent'),
  GIT_AUTHOR_EMAIL: z.string().default('hermes@users.noreply.github.com'),
  BRANCH_PREFIX: z.string().default('hermes/issue-'),
  // Optional dedicated SSH deploy key for cloning/pushing dashboard jobs over SSH. When
  // unset, git uses the host's own SSH setup (agent, ~/.ssh/config, default keys).
  GIT_SSH_KEY_PATH: z.string().optional(),

  // sandbox
  SANDBOX_MODE: z.enum(['none', 'default']).default('default'),
  DOCKER_AGENT_IMAGE: z.string().default('hermes-agent:latest'),
});

export type Env = z.infer<typeof envSchema>;
