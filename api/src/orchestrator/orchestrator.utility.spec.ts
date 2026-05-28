import { acceptanceCriteria, buildPrBody, parseCommand } from './orchestrator.utility.js';

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
  it('links the issue and reports confidence', () => {
    const body = buildPrBody({
      issueNumber: 7,
      plan: 'do x',
      confidence: 90,
      threshold: 85,
      meetsThreshold: true,
    });
    expect(body).toContain('Closes #7');
    expect(body).toContain('90/100');
  });

  it('lists unresolved issues when below threshold', () => {
    const body = buildPrBody({
      issueNumber: 7,
      plan: 'p',
      confidence: 60,
      threshold: 85,
      meetsThreshold: false,
      unresolvedIssues: '1. [high] boom',
    });
    expect(body).toContain('boom');
  });
});
