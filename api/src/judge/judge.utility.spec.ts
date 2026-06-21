import { parseJudgeVerdict } from './judge.utility.js';

describe('parseJudgeVerdict', () => {
  it('parses a passed verdict', () => {
    expect(parseJudgeVerdict('```json\n{"passed":true,"critique":""}\n```')).toEqual({
      passed: true,
      critique: '',
    });
  });

  it('parses a not-passed verdict with a critique, ignoring surrounding text', () => {
    expect(
      parseJudgeVerdict('reasoning ```json\n{"passed":false,"critique":"finish X"}\n``` trailing'),
    ).toEqual({ passed: false, critique: 'finish X' });
  });

  it('trims the critique', () => {
    expect(parseJudgeVerdict('{"passed":false,"critique":"  do it  "}')?.critique).toBe('do it');
  });

  it('recovers passed:false even when the critique string breaks strict JSON', () => {
    // The judge often writes a multi-line critique with literal newlines / unescaped quotes,
    // which makes JSON.parse fail. We must still recover the verdict (not fall open to passed).
    const stdout =
      '```json\n{\n  "passed": false,\n  "critique": "Broken: tests fail.\nLine two with a " quote"\n}\n```';
    const verdict = parseJudgeVerdict(stdout);
    expect(verdict?.passed).toBe(false);
    expect(verdict?.critique).toContain('tests fail');
  });

  it('returns null when passed is missing or non-boolean, or there is no JSON', () => {
    expect(parseJudgeVerdict('```json\n{"critique":"x"}\n```')).toBeNull();
    expect(parseJudgeVerdict('{"passed":"yes"}')).toBeNull();
    expect(parseJudgeVerdict('no json here')).toBeNull();
  });
});
