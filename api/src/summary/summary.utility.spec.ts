import { buildPrBody } from './summary.utility.js';

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
