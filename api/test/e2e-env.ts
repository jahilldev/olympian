// Sets required env vars before any test module is imported.
// With ESM, static imports are hoisted and evaluated before module-level code,
// so process.env assignments inside the test file come too late. Jest's
// setupFiles run in the same process but before test modules are loaded.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.GITHUB_APP_ID = '123';
process.env.GITHUB_WEBHOOK_SECRET = 'e2e-secret';
process.env.WORKER_ENABLED = 'false';
