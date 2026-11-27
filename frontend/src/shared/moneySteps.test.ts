import { describe, expect, it } from 'vitest';
import { moneySteps } from './moneySteps';

const labels: [string, string, string] = ['Paid in', 'Held', 'Paid out'];
const states = (current: Parameters<typeof moneySteps>[1]) => moneySteps(labels, current).map((s) => s.state);

describe('moneySteps (U11-15)', () => {
  it('FR-PAY-01 the step before the one the money is at is done, that one is marked, the rest wait', () => {
    expect(states('in')).toEqual(['current', 'next', 'next']);
    expect(states('held')).toEqual(['done', 'current', 'next']);
    expect(states('out')).toEqual(['done', 'done', 'current']);
  });

  it('FR-PAY-01 "done" marks all three as done and nothing yet marks none', () => {
    expect(states('done')).toEqual(['done', 'done', 'done']);
    expect(states(null)).toEqual(['next', 'next', 'next']);
  });
});
