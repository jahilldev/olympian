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
  HERMES_TESTING_MODEL: z.string().optional(),
  HERMES_TESTING_PROVIDER: z.string().optional(),
  HERMES_TIMEOUT_MS: intFromString(7_200_000),
  // Idle timeout for PLAN and REVIEW phases: kill if no stdout/stderr for this long.
  // Catches hung/dead model connections without penalising slow generation.
  HERMES_PLAN_TIMEOUT_MS: intFromString(3_600_000),
  // Idle timeout for IMPLEMENT, TEST, and REVISE phases. These agents run builds,
  // test suites, and browser automation that can be legitimately silent for far
  // longer than planning or review turns.
  HERMES_WORK_TIMEOUT_MS: intFromString(7_200_000),

  // orchestration policy
  TRIGGER_LABEL: z.string().default('hermes'),
  REVIEW_CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(85),
  MAX_PLAN_REVISIONS: intFromString(10),
  MAX_IMPLEMENTATION_ITERATIONS: intFromString(5),
  MAX_REVIEW_PASSES: intFromString(5),
  MAX_TEST_ITERATIONS: intFromString(3),
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

  // sandbox
  SANDBOX_MODE: z.enum(['none', 'docker']).default('none'),
  DOCKER_AGENT_IMAGE: z.string().default('hermes-agent:latest'),
  VERIFY_COMMAND: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
