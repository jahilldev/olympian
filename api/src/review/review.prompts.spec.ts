import { buildReviewPrompt } from './review.prompts.js';
import type { ReviewPromptContext } from './review.model.js';

const baseCtx: ReviewPromptContext = {
  repoFullName: 'o/r',
  issueTitle: 'Title',
  issueBody: 'Body',
  plan: 'the plan',
  baseBranch: 'main',
  changedFiles: ['src/a.ts'],
  threshold: 85,
};

describe('buildReviewPrompt parseRetry guidance', () => {
  it('omits retry guidance on a first pass', () => {
    const p = buildReviewPrompt(baseCtx);
    expect(p).not.toContain('RETRY');
  });

  it('injects schema-conformance guidance when retrying after an unparseable pass', () => {
    const p = buildReviewPrompt({ ...baseCtx, parseRetry: true });
    expect(p).toContain('RETRY');
    // The divergences that actually caused the failure must be called out by name.
    expect(p).toContain('"PASS" or "FAIL"');
    expect(p).toContain('NOT a boolean');
    expect(p).toContain('`confidence` MUST be present');
    expect(p).toContain('rationale'); // explicitly warns against this stray key
    // `issues` is emphasised as the critical field — it is the only thing the fix stage receives.
    expect(p).toContain('MOST IMPORTANT');
    expect(p).toContain('ONLY thing passed to the agent that fixes the code');
  });
});
