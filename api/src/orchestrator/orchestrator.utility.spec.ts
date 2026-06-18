import { buildStatusReport, parseCommand } from './orchestrator.utility.js';

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
