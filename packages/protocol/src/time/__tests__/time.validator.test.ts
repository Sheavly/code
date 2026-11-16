import { describe, expect, it } from 'vitest';
import { timestampSchema } from '../time.validator.js';

describe('timestampSchema', () => {
  it.each([0, 1, 1_794_836_581_438])('accepts %j milliseconds since the epoch', (value) => {
    expect(timestampSchema.parse(value)).toBe(value);
  });

  it.each([-1, 0.5, Infinity, NaN, '100', null])('rejects %j', (value) => {
    expect(timestampSchema.safeParse(value).success).toBe(false);
  });
});
