import { backoffMs } from './queue.utility.js';

describe('backoffMs', () => {
  it('grows exponentially with attempt number', () => {
    expect(backoffMs(1, 1000)).toBe(1000);
    expect(backoffMs(2, 1000)).toBe(2000);
    expect(backoffMs(3, 1000)).toBe(4000);
  });

  it('clamps attempts below 1', () => {
    expect(backoffMs(0, 1000)).toBe(1000);
  });
});
