import { readFileSync } from 'node:fs';
import { type Env, envSchema } from './config.model.js';

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Resolves the GitHub App private key from either the inline env var (supporting
 * literal "\n" sequences) or a PEM file path. Returns null when neither is set.
 */
export function resolvePrivateKey(inline?: string, path?: string): string | null {
  if (inline && inline.trim().length > 0) {
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }
  if (path && path.trim().length > 0) {
    return readFileSync(path, 'utf8');
  }
  return null;
}
