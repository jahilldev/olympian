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

  it('returns null when passed is missing or non-boolean, or there is no JSON', () => {
    expect(parseJudgeVerdict('```json\n{"critique":"x"}\n```')).toBeNull();
    expect(parseJudgeVerdict('{"passed":"yes"}')).toBeNull();
    expect(parseJudgeVerdict('no json here')).toBeNull();
  });
});
