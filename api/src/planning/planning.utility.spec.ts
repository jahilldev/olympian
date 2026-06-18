import {
  acceptanceCriteria,
  missingPlanSections,
  planFilePaths,
  renderPlanComment,
} from './planning.utility.js';

describe('missingPlanSections', () => {
  it('lists required sections absent from the plan', () => {
    const plan = '## Summary\nx\n## Approach\ny';
    const missing = missingPlanSections(plan);
    expect(missing).toContain('## Files to change');
    expect(missing).not.toContain('## Summary');
  });

  it('returns nothing when all required sections are present', () => {
    const plan = [
      '## Summary',
      '## Approach',
      '## Files to change',
      '## Acceptance criteria',
      '## Risks & open questions',
    ].join('\nx\n');
    expect(missingPlanSections(plan)).toEqual([]);
  });
});

describe('acceptanceCriteria', () => {
  it('extracts the acceptance-criteria section', () => {
    const plan = '## Summary\nx\n## Acceptance criteria\n- [ ] a\n- [ ] b\n## Risks\ny';
    expect(acceptanceCriteria(plan)).toBe('- [ ] a\n- [ ] b');
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
      '- `README` — bare token without slash or ext, skipped',
      '## Risks',
      'none',
    ].join('\n');
    const paths = planFilePaths(plan);
    expect(paths).toContain('src/foo.ts');
    expect(paths).toContain('src/bar/baz.ts');
    expect(paths).not.toContain('not/counted.ts');
  });
});

describe('renderPlanComment', () => {
  it('includes the plan and the approve instruction', () => {
    const out = renderPlanComment('the plan body', '/hermes');
    expect(out).toContain('the plan body');
    expect(out).toContain('/hermes approve');
  });

  it('surfaces grounding warnings when paths are missing', () => {
    const out = renderPlanComment('plan', '/hermes', ['src/ghost.ts']);
    expect(out).toContain('Plan grounding');
    expect(out).toContain('src/ghost.ts');
  });
});
