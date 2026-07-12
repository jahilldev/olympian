import {
  failedDimensions,
  formatIssues,
  meetsThreshold,
  outOfPlanChanges,
  parseReview,
  reviewResultFromRecord,
} from './review.utility.js';
import { type ReviewResult } from './review.model.js';

const PASS_DIMS = { correctness: true, tests: true, criteria: true, security: true };

function result(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    confidence: 90,
    verdict: 'PASS',
    dimensions: { ...PASS_DIMS },
    issues: [],
    verifyOk: null,
    ...overrides,
  };
}

describe('parseReview', () => {
  it('parses a fenced json verdict with rubric dimensions', () => {
    const out =
      'Here is my review:\n```json\n{"confidence":92,"verdict":"PASS","dimensions":{"correctness":true,"tests":true,"criteria":true,"security":true},"issues":[]}\n```';
    const r = parseReview(out);
    expect(r?.confidence).toBe(92);
    expect(r?.verdict).toBe('PASS');
    expect(r?.dimensions.tests).toBe(true);
    expect(r?.verifyOk).toBeNull();
  });

  it('accepts stringy "pass"/"fail" dimension values', () => {
    const r = parseReview(
      '{"confidence":50,"dimensions":{"correctness":"pass","tests":"fail","criteria":"yes","security":true},"issues":[]}',
    );
    expect(r?.dimensions.tests).toBe(false);
    expect(r?.dimensions.criteria).toBe(true);
  });

  it('normalises a lowercase verdict rather than rejecting the whole review', () => {
    const r = parseReview(
      '{"confidence":92,"verdict":"pass","dimensions":{"correctness":true,"tests":true,"criteria":true,"security":true},"issues":[]}',
    );
    expect(r?.verdict).toBe('PASS');
  });

  it('ignores an unrecognised verdict string and derives one from the rubric', () => {
    const r = parseReview(
      '{"confidence":80,"verdict":"maybe","dimensions":{"correctness":false,"tests":true,"criteria":true,"security":true},"issues":[]}',
    );
    expect(r?.verdict).toBe('FAIL');
  });

  it('derives FAIL when a dimension fails even with no explicit verdict', () => {
    const r = parseReview(
      '{"confidence":80,"dimensions":{"correctness":false,"tests":true,"criteria":true,"security":true},"issues":[]}',
    );
    expect(r?.verdict).toBe('FAIL');
  });

  it('derives FAIL when a blocking issue is present and no verdict is given', () => {
    const r = parseReview(
      '{"confidence":40,"issues":[{"severity":"high","title":"bug","detail":"npe"}]}',
    );
    expect(r?.verdict).toBe('FAIL');
  });

  it('defaults dimensions to all-pass when the model omits them', () => {
    const r = parseReview('{"confidence":88,"verdict":"PASS","issues":[]}');
    expect(r?.dimensions).toEqual(PASS_DIMS);
  });

  it('returns null when no JSON can be recovered', () => {
    expect(parseReview('no structured output here')).toBeNull();
  });

  // The contract is strict: an off-schema review (here: boolean verdict + missing confidence) is
  // rejected so the orchestrator re-runs it, rather than being coerced into a possibly-misread shape.
  it('returns null for an off-schema verdict (must re-run, not salvage)', () => {
    expect(
      parseReview(
        '```json\n{"verdict":false,"dimensions":{"correctness":false,"tests":true,"criteria":false,"security":true}}\n```',
      ),
    ).toBeNull();
  });
});

describe('meetsThreshold', () => {
  it('passes when verdict PASS, all dimensions hold, no blocking issues, verify not red', () => {
    expect(meetsThreshold(result())).toBe(true);
    expect(meetsThreshold(result({ verifyOk: true }))).toBe(true);
  });

  it('ignores confidence — a low-confidence clean review still passes', () => {
    expect(meetsThreshold(result({ confidence: 10 }))).toBe(true);
  });

  it('fails when the verify command is red, regardless of the verdict', () => {
    expect(meetsThreshold(result({ verifyOk: false }))).toBe(false);
  });

  it('fails when any rubric dimension fails', () => {
    expect(meetsThreshold(result({ dimensions: { ...PASS_DIMS, tests: false } }))).toBe(false);
  });

  it('fails when a high/critical issue exists', () => {
    expect(
      meetsThreshold(result({ issues: [{ severity: 'critical', title: 'x', detail: 'y' }] })),
    ).toBe(false);
  });

  it('fails when the verdict is FAIL', () => {
    expect(meetsThreshold(result({ verdict: 'FAIL' }))).toBe(false);
  });
});

describe('failedDimensions', () => {
  it('lists the human labels of failing dimensions', () => {
    expect(failedDimensions({ ...PASS_DIMS, tests: false, criteria: false })).toEqual([
      'tests',
      'acceptance criteria',
    ]);
  });
});

describe('reviewResultFromRecord', () => {
  it('rebuilds a result from persisted row fields', () => {
    const r = reviewResultFromRecord({
      confidence: 70,
      verdict: 'PASS',
      dimensions: JSON.stringify({ ...PASS_DIMS, security: false }),
      verifyOk: true,
      issues: JSON.stringify([{ severity: 'low', title: 'nit', detail: 'd' }]),
    });
    expect(r.verifyOk).toBe(true);
    expect(r.dimensions.security).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(meetsThreshold(r)).toBe(false); // security dimension failed
  });

  it('falls back to all-pass dimensions when the stored JSON is missing', () => {
    const r = reviewResultFromRecord({
      confidence: 90,
      verdict: 'PASS',
      dimensions: null,
      verifyOk: null,
      issues: '[]',
    });
    expect(r.dimensions).toEqual(PASS_DIMS);
    expect(meetsThreshold(r)).toBe(true);
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
