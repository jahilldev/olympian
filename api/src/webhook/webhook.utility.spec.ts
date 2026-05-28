import { createHmac } from 'node:crypto';
import { isPullRequestThread, verifySignature } from './webhook.utility.js';

const secret = 's3cret';
const body = '{"hello":"world"}';
const sign = (s: string, b: string) =>
  `sha256=${createHmac('sha256', s).update(b, 'utf8').digest('hex')}`;

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(secret, body, sign(secret, body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySignature(secret, `${body} `, sign(secret, body))).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(verifySignature('nope', body, sign(secret, body))).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifySignature(secret, body, undefined)).toBe(false);
    expect(verifySignature(secret, body, 'garbage')).toBe(false);
  });
});

describe('isPullRequestThread', () => {
  it('distinguishes PR threads from issues', () => {
    expect(isPullRequestThread({ pull_request: {} })).toBe(true);
    expect(isPullRequestThread({})).toBe(false);
  });
});
