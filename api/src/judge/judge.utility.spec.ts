import { parseJudgeVerdict } from './judge.utility.js';

describe('parseJudgeVerdict', () => {
  it('parses a passed verdict (JSON block only)', () => {
    expect(parseJudgeVerdict('```json\n{"passed": true}\n```')).toEqual({
      passed: true,
      critique: '',
    });
  });

  it('captures the summary on a passed verdict (kept for oversight)', () => {
    const verdict = parseJudgeVerdict(
      '```json\n{"passed": true}\n```\n\n## Critique\nAll criteria met; tests pass.',
    );
    expect(verdict?.passed).toBe(true);
    expect(verdict?.critique).toBe('All criteria met; tests pass.');
  });

  it('takes the critique as the markdown beneath the JSON block', () => {
    const verdict = parseJudgeVerdict(
      '```json\n{"passed": false}\n```\n\n## Critique\nFinish `foo()` in src/x.ts.',
    );
    expect(verdict?.passed).toBe(false);
    expect(verdict?.critique).toBe('Finish `foo()` in src/x.ts.');
  });

  it('preserves a critique containing markdown code fences and quotes', () => {
    const stdout =
      '```json\n{"passed": false}\n```\n\n## Critique\n' +
      'Fix the bug:\n```ts\nconst a = "b";\n```\nThen add a test that "fails" first.';
    const verdict = parseJudgeVerdict(stdout);
    expect(verdict?.passed).toBe(false);
    expect(verdict?.critique).toContain('```ts');
    expect(verdict?.critique).toContain('const a = "b";');
    expect(verdict?.critique).toContain('Then add a test');
    // The JSON verdict block must not leak into the critique.
    expect(verdict?.critique).not.toContain('"passed"');
  });

  it('falls back to a bare (unfenced) verdict object', () => {
    const verdict = parseJudgeVerdict('{"passed": false}\nNeeds more work.');
    expect(verdict?.passed).toBe(false);
    expect(verdict?.critique).toBe('Needs more work.');
  });

  it('returns null when there is no passed boolean', () => {
    expect(parseJudgeVerdict('```json\n{"foo": 1}\n```')).toBeNull();
    expect(parseJudgeVerdict('{"passed":"yes"}')).toBeNull();
    expect(parseJudgeVerdict('no verdict here')).toBeNull();
  });
});
