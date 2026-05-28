import { formatIssues, meetsThreshold, parseReview } from './review.utility.js';

describe('parseReview', () => {
  it('parses a fenced json verdict', () => {
    const out = 'Here is my review:\n```json\n{"confidence":92,"verdict":"PASS","issues":[]}\n```';
    const r = parseReview(out);
    expect(r?.confidence).toBe(92);
    expect(r?.verdict).toBe('PASS');
  });

  it('derives FAIL when a blocking issue is present and no verdict is given', () => {
    const r = parseReview(
      '{"confidence":40,"issues":[{"severity":"high","title":"bug","detail":"npe"}]}',
    );
    expect(r?.verdict).toBe('FAIL');
  });

  it('returns null when no JSON can be recovered', () => {
    expect(parseReview('no structured output here')).toBeNull();
  });
});

describe('meetsThreshold', () => {
  it('passes when verdict PASS, above threshold, no blocking issues', () => {
    expect(meetsThreshold({ confidence: 90, verdict: 'PASS', issues: [] }, 85)).toBe(true);
  });

  it('fails below threshold', () => {
    expect(meetsThreshold({ confidence: 80, verdict: 'PASS', issues: [] }, 85)).toBe(false);
  });

  it('fails when a high/critical issue exists even at high confidence', () => {
    expect(
      meetsThreshold(
        {
          confidence: 99,
          verdict: 'PASS',
          issues: [{ severity: 'critical', title: 'x', detail: 'y' }],
        },
        85,
      ),
    ).toBe(false);
  });
});

describe('formatIssues', () => {
  it('renders a numbered list with severity and file', () => {
    const text = formatIssues([
      { severity: 'high', title: 'leak', detail: 'fix it', file: 'a.ts' },
    ]);
    expect(text).toContain('[high] leak');
    expect(text).toContain('a.ts');
  });
});
