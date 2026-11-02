import { describe, expect, it } from 'vitest';
import { approvalResponseSchema } from '../approvals.validator.js';

describe('approvalResponseSchema', () => {
  it('accepts each decision a UI can give', () => {
    expect(approvalResponseSchema.parse({ decision: 'approve' })).toEqual({ decision: 'approve' });
    expect(approvalResponseSchema.parse({ decision: 'skip' })).toEqual({ decision: 'skip' });
    expect(
      approvalResponseSchema.parse({ decision: 'skip_with_message', message: '  use npm ci  ' }),
    ).toEqual({ decision: 'skip_with_message', message: 'use npm ci' });
  });

  it('rejects an unknown decision', () => {
    expect(approvalResponseSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(approvalResponseSchema.safeParse({}).success).toBe(false);
  });

  it('rejects skip_with_message without a message, or with only spaces', () => {
    expect(approvalResponseSchema.safeParse({ decision: 'skip_with_message' }).success).toBe(false);
    expect(
      approvalResponseSchema.safeParse({ decision: 'skip_with_message', message: '   ' }).success,
    ).toBe(false);
  });
});
