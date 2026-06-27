import { buildStatusReport, parseCommand, parseCommitMessage } from './orchestrator.utility.js';

describe('parseCommitMessage', () => {
  it('extracts subject + body from a fenced commit block', () => {
    const out = `Done — summary here.\n\n\`\`\`commit\nfeat: add AABB broad-phase collision\n\n- add PhysicsEngine.broadPhase()\n- wire HUD collision counter\n\`\`\`\n`;
    expect(parseCommitMessage(out)).toBe(
      'feat: add AABB broad-phase collision\n\n- add PhysicsEngine.broadPhase()\n- wire HUD collision counter',
    );
  });

  it('returns just the subject when there is no body', () => {
    expect(parseCommitMessage('```commit\nfix: correct off-by-one in pager\n```')).toBe(
      'fix: correct off-by-one in pager',
    );
  });

  it('takes the LAST block (ignores an echoed example)', () => {
    const out =
      '```commit\nfeat: <summary>\n```\nthinking...\n```commit\nfeat: real change to loader\n```';
    expect(parseCommitMessage(out)).toBe('feat: real change to loader');
  });

  it('caps an over-long subject to 72 chars', () => {
    const subj = 'feat: ' + 'x'.repeat(120);
    expect(parseCommitMessage(`\`\`\`commit\n${subj}\n\`\`\``)).toHaveLength(72);
  });

  it('returns null when no commit block is present', () => {
    expect(parseCommitMessage('just a prose summary, no block')).toBeNull();
    expect(parseCommitMessage('```commit\n\n```')).toBeNull();
  });
});

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
