import { describe, expect, it } from 'vitest';
import { nextRetryAt, validateRetrySchedule } from '../dunning.js';

const DAY = 24 * 60 * 60 * 1000;

describe('dunning schedules (#813)', () => {
  it('accepts an ascending schedule', () => {
    expect(validateRetrySchedule([1, 3, 5, 7])).toBeNull();
    expect(validateRetrySchedule([0.5, 2])).toBeNull();
  });

  it('rejects invalid schedules', () => {
    expect(validateRetrySchedule([])).toMatch(/at least one retry/);
    expect(validateRetrySchedule([1, 1])).toMatch(/strictly ascending/);
    expect(validateRetrySchedule([3, 2])).toMatch(/strictly ascending/);
    expect(validateRetrySchedule([-1])).toMatch(/positive numbers/);
    expect(validateRetrySchedule([1, 90])).toMatch(/beyond 60 days/);
    expect(validateRetrySchedule(Array.from({ length: 11 }, (_, i) => i + 1))).toMatch(/at most 10/);
  });

  it('computes retries relative to the initial failure', () => {
    expect(nextRetryAt(0, [1, 3], 0)).toBe(DAY);
    expect(nextRetryAt(0, [1, 3], 1)).toBe(3 * DAY);
    expect(nextRetryAt(0, [1, 3], 2)).toBeUndefined();
  });
});
