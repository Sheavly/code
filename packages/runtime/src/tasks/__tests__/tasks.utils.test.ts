import { describe, expect, it } from 'vitest';
import { settledStatus } from '../tasks.utils.js';

describe('settledStatus', () => {
  it.each([
    ['completed', false, 'completed'],
    ['completed', true, 'completed'],
    ['failed', false, 'failed'],
    ['failed', true, 'cancelled'],
    ['cancelled', false, 'cancelled'],
    ['cancelled', true, 'cancelled'],
  ] as const)('a run that ended %s (aborted: %s) settles as %s', (status, aborted, expected) => {
    expect(settledStatus({ status, aborted })).toBe(expected);
  });
});
