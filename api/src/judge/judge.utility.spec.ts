import { judgeMetFromStderr, parseJudgeVerdict } from './judge.utility.js';
import { JUDGE_MET_MARKER, JUDGE_UNMET_MARKER } from './judge.model.js';

describe('parseJudgeVerdict', () => {
  it('parses a met verdict', () => {
    expect(parseJudgeVerdict('```json\n{"met":true,"critique":""}\n```')).toEqual({
      met: true,
      critique: '',
    });
  });

  it('parses a not-met verdict with a critique, ignoring surrounding text', () => {
    expect(
      parseJudgeVerdict('reasoning ```json\n{"met":false,"critique":"finish X"}\n``` trailing'),
    ).toEqual({ met: false, critique: 'finish X' });
  });

  it('trims the critique', () => {
    expect(parseJudgeVerdict('{"met":false,"critique":"  do it  "}')?.critique).toBe('do it');
  });

  it('returns null when met is missing or non-boolean, or there is no JSON', () => {
    expect(parseJudgeVerdict('```json\n{"critique":"x"}\n```')).toBeNull();
    expect(parseJudgeVerdict('{"met":"yes"}')).toBeNull();
    expect(parseJudgeVerdict('no json here')).toBeNull();
  });
});

describe('judgeMetFromStderr', () => {
  it('reads the met / unmet / unknown markers', () => {
    expect(judgeMetFromStderr(`build noise\n${JUDGE_MET_MARKER}`)).toBe(true);
    expect(judgeMetFromStderr(`build noise\n${JUDGE_UNMET_MARKER}`)).toBe(false);
    expect(judgeMetFromStderr('no marker')).toBeNull();
    expect(judgeMetFromStderr(null)).toBeNull();
    expect(judgeMetFromStderr(undefined)).toBeNull();
  });
});
