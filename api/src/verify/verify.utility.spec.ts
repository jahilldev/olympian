import { parseVerifyCommand } from './verify.utility.js';

describe('parseVerifyCommand', () => {
  it('extracts the command from a fenced json block', () => {
    const out = 'Reasoning...\n```json\n{ "command": "npm ci && npm test" }\n```';
    expect(parseVerifyCommand(out)).toBe('npm ci && npm test');
  });

  it('returns an empty string when the repo has no checks', () => {
    expect(parseVerifyCommand('{ "command": "" }')).toBe('');
  });

  it('returns an empty string when output is unparseable', () => {
    expect(parseVerifyCommand('I could not determine a command')).toBe('');
  });
});
