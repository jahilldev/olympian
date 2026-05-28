import { canTransition } from './job.utility.js';

describe('canTransition', () => {
  it('allows the happy path forward edges', () => {
    expect(canTransition('TRIAGED', 'PLANNING')).toBe(true);
    expect(canTransition('PLANNING', 'AWAITING_PLAN_APPROVAL')).toBe(true);
    expect(canTransition('AWAITING_PLAN_APPROVAL', 'IMPLEMENTING')).toBe(true);
    expect(canTransition('IMPLEMENTING', 'SELF_REVIEWING')).toBe(true);
    expect(canTransition('SELF_REVIEWING', 'OPENING_PR')).toBe(true);
    expect(canTransition('OPENING_PR', 'AWAITING_PR_APPROVAL')).toBe(true);
    expect(canTransition('AWAITING_PR_APPROVAL', 'DONE')).toBe(true);
  });

  it('allows the iteration loops', () => {
    expect(canTransition('AWAITING_PLAN_APPROVAL', 'PLANNING')).toBe(true);
    expect(canTransition('SELF_REVIEWING', 'REVISING')).toBe(true);
    expect(canTransition('REVISING', 'SELF_REVIEWING')).toBe(true);
    expect(canTransition('AWAITING_PR_APPROVAL', 'IMPLEMENTING')).toBe(true);
  });

  it('forbids illegal jumps', () => {
    expect(canTransition('TRIAGED', 'DONE')).toBe(false);
    expect(canTransition('PLANNING', 'OPENING_PR')).toBe(false);
  });

  it('allows bail-out to FAILED/CANCELLED from any non-terminal state', () => {
    expect(canTransition('IMPLEMENTING', 'FAILED')).toBe(true);
    expect(canTransition('PLANNING', 'CANCELLED')).toBe(true);
  });

  it('forbids leaving a terminal state', () => {
    expect(canTransition('DONE', 'PLANNING')).toBe(false);
    expect(canTransition('FAILED', 'IMPLEMENTING')).toBe(false);
    expect(canTransition('CANCELLED', 'PLANNING')).toBe(false);
  });
});
