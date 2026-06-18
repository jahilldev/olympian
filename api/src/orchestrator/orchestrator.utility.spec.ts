import {
  acceptanceCriteria,
  buildPrBody,
  buildStatusReport,
  outOfPlanChanges,
  parseCommand,
  planFilePaths,
} from './orchestrator.utility.js';

describe('parseCommand', () => {
  it('parses approve (case-insensitive, any line)', () => {
    expect(parseCommand('/hermes approve', '/hermes').kind).toBe('approve');
    expect(parseCommand('sounds good\n/Hermes Approve', '/hermes').kind).toBe('approve');
    expect(parseCommand('/hermes lgtm', '/hermes').kind).toBe('approve');
  });

  it('parses cancel and status', () => {
    expect(parseCommand('/hermes cancel', '/hermes').kind).toBe('cancel');
    expect(parseCommand('/hermes status', '/hermes').kind).toBe('status');
  });

  it('parses revise with trailing text', () => {
    const cmd = parseCommand('/hermes revise please use zod for validation', '/hermes');
    expect(cmd.kind).toBe('revise');
    expect(cmd.text).toContain('zod');
  });

  it('returns none for a plain comment (treated as feedback)', () => {
    expect(parseCommand('I think you should use a different approach', '/hermes').kind).toBe(
      'none',
    );
  });
});

describe('acceptanceCriteria', () => {
  it('extracts the acceptance-criteria section', () => {
    const plan = '## Summary\nx\n## Acceptance criteria\n- [ ] a\n- [ ] b\n## Risks\ny';
    expect(acceptanceCriteria(plan)).toBe('- [ ] a\n- [ ] b');
  });
});

describe('buildPrBody', () => {
  it('links the issue and reports a passing review with verify state', () => {
    const body = buildPrBody({
      issueNumber: 7,
      agentSummary: 'do x',
      confidence: 90,
      meetsThreshold: true,
      verifyOk: true,
      failedDimensions: [],
    });
    expect(body).toContain('Closes #7');
    expect(body).toContain('passed');
    expect(body).toContain('tests: passing');
  });

  it('lists unresolved issues and failing checks when the review did not pass', () => {
    const body = buildPrBody({
      issueNumber: 7,
      agentSummary: 'p',
      confidence: 60,
      meetsThreshold: false,
      verifyOk: false,
      failedDimensions: ['tests', 'correctness'],
      unresolvedIssues: '1. [high] boom',
    });
    expect(body).toContain('boom');
    expect(body).toContain('did NOT pass');
    expect(body).toContain('tests: failing');
    expect(body).toContain('tests, correctness');
  });

  it('reports tests as not run when no verify command exists', () => {
    const body = buildPrBody({
      issueNumber: 7,
      agentSummary: 'p',
      confidence: 90,
      meetsThreshold: true,
      verifyOk: null,
      failedDimensions: [],
    });
    expect(body).toContain('tests: not run');
  });
});

describe('planFilePaths', () => {
  it('extracts backticked paths from the Files to change section only', () => {
    const plan = [
      '## Approach',
      'We touch `not/counted.ts` here in prose.',
      '## Files to change',
      '- `src/foo.ts` — add the thing',
      '- `src/bar/baz.ts` — wire it up',
      '- `README` — not a path-like token without slash or ext, skipped',
      '## Risks',
      'none',
    ].join('\n');
    const paths = planFilePaths(plan);
    expect(paths).toContain('src/foo.ts');
    expect(paths).toContain('src/bar/baz.ts');
    expect(paths).not.toContain('not/counted.ts');
  });
});

describe('outOfPlanChanges', () => {
  it('flags changed files the plan never declared', () => {
    const planPaths = ['src/foo.ts', 'src/bar/baz.ts'];
    const changed = ['src/foo.ts', 'src/unexpected.ts'];
    expect(outOfPlanChanges(changed, planPaths)).toEqual(['src/unexpected.ts']);
  });

  it('matches on basename so a bare filename in the plan still covers it', () => {
    expect(outOfPlanChanges(['pkg/sub/foo.ts'], ['foo.ts'])).toEqual([]);
  });

  it('returns nothing when the plan declared no paths (cannot judge scope)', () => {
    expect(outOfPlanChanges(['a.ts', 'b.ts'], [])).toEqual([]);
  });
});

describe('buildStatusReport', () => {
  it('shows state label and active agent run', () => {
    const startedAt = new Date(Date.now() - 3 * 60_000);
    const report = buildStatusReport({
      state: 'IMPLEMENTING',
      confidence: null,
      error: null,
      prNumber: null,
      activeRunPhase: 'IMPLEMENT',
      activeRunStartedAt: startedAt,
      reviewPassCount: 0,
      activeTask: null,
      commandPrefix: '/hermes',
    });
    expect(report).toContain('IMPLEMENTING');
    expect(report).toContain('IMPLEMENT');
    expect(report).toContain('3 min');
  });

  it('shows review pass count and confidence', () => {
    const report = buildStatusReport({
      state: 'SELF_REVIEWING',
      confidence: 74,
      error: null,
      prNumber: null,
      activeRunPhase: null,
      activeRunStartedAt: null,
      reviewPassCount: 2,
      activeTask: null,
      commandPrefix: '/hermes',
    });
    expect(report).toContain('2');
    expect(report).toContain('74/100');
  });

  it('shows task retry count and last error', () => {
    const report = buildStatusReport({
      state: 'IMPLEMENTING',
      confidence: null,
      error: null,
      prNumber: null,
      activeRunPhase: null,
      activeRunStartedAt: null,
      reviewPassCount: 0,
      activeTask: { attempts: 2, maxAttempts: 3, lastError: 'timeout' },
      commandPrefix: '/hermes',
    });
    expect(report).toContain('2/3');
    expect(report).toContain('timeout');
  });

  it('shows approval hint when awaiting plan approval', () => {
    const report = buildStatusReport({
      state: 'AWAITING_PLAN_APPROVAL',
      confidence: null,
      error: null,
      prNumber: null,
      activeRunPhase: null,
      activeRunStartedAt: null,
      reviewPassCount: 0,
      activeTask: null,
      commandPrefix: '/hermes',
    });
    expect(report).toContain('/hermes approve');
  });
});
