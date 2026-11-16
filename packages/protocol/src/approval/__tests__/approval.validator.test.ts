import { describe, expect, it } from 'vitest';
import {
  approvalOptionSchema,
  approvalRequestSchema,
  approvalResponseOfferedBy,
  approvalResponseSchema,
  approvalUpdateSchema,
} from '../approval.validator.js';

const REQUEST = {
  id: 'approval-1',
  callId: 'call-1',
  tool: 'run_command',
  command: 'rm -rf build',
  concerns: [{ argument: '-rf', reason: 'deletes recursively' }],
  options: ['approve', 'skip', 'skip_with_message'],
};

describe('approvalResponseSchema', () => {
  it('accepts each decision a UI can give', () => {
    expect(approvalResponseSchema.parse({ decision: 'approve' })).toEqual({ decision: 'approve' });
    expect(approvalResponseSchema.parse({ decision: 'allow_session' })).toEqual({
      decision: 'allow_session',
    });
    expect(approvalResponseSchema.parse({ decision: 'always_allow' })).toEqual({
      decision: 'always_allow',
    });
    expect(approvalResponseSchema.parse({ decision: 'skip' })).toEqual({ decision: 'skip' });
    expect(
      approvalResponseSchema.parse({ decision: 'skip_with_message', message: '  use npm ci  ' }),
    ).toEqual({ decision: 'skip_with_message', message: 'use npm ci' });
  });

  it('rejects skip_with_message without a message, or with only spaces', () => {
    expect(approvalResponseSchema.safeParse({ decision: 'skip_with_message' }).success).toBe(false);
    expect(
      approvalResponseSchema.safeParse({ decision: 'skip_with_message', message: '   ' }).success,
    ).toBe(false);
  });

  it('rejects an unknown or missing decision', () => {
    expect(approvalResponseSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(approvalResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('approvalResponseOfferedBy', () => {
  const offered = approvalResponseOfferedBy(['approve', 'skip']);

  it('accepts a decision the request offered', () => {
    expect(offered.parse({ decision: 'approve' })).toEqual({ decision: 'approve' });
  });

  it('rejects a well-formed decision the request did not offer', () => {
    const result = offered.safeParse({ decision: 'always_allow' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['decision']);
  });

  it('still rejects a malformed answer to an offered decision', () => {
    expect(
      approvalResponseOfferedBy(['skip_with_message']).safeParse({ decision: 'skip_with_message' })
        .success,
    ).toBe(false);
  });
});

describe('approvalOptionSchema', () => {
  it('offers exactly the decisions a response can make', () => {
    const decisions = approvalResponseSchema.options.map((option) => option.shape.decision.value);

    expect([...approvalOptionSchema.options].sort()).toEqual([...decisions].sort());
  });
});

describe('approvalRequestSchema and approvalUpdateSchema', () => {
  it('accept a request with and without a session', () => {
    expect(approvalRequestSchema.parse(REQUEST)).toEqual(REQUEST);
    expect(approvalRequestSchema.parse({ ...REQUEST, sessionId: 's-1' }).sessionId).toBe('s-1');
  });

  it('reject a request offering an option that is not a decision', () => {
    expect(approvalRequestSchema.safeParse({ ...REQUEST, options: ['retry'] }).success).toBe(false);
  });

  it('carry the entries always-allow would keep, and only valid ones', () => {
    expect(
      approvalRequestSchema.parse({
        ...REQUEST,
        options: ['approve', 'allow_session'],
        keeps: ['npx vitest run *'],
      }).keeps,
    ).toEqual(['npx vitest run *']);
    expect(approvalRequestSchema.parse({ ...REQUEST, keeps: ['git log *'] }).keeps).toEqual([
      'git log *',
    ]);
    expect(approvalRequestSchema.parse(REQUEST)).not.toHaveProperty('keeps');

    for (const keeps of [['*'], ['git  log'], ['']]) {
      expect(approvalRequestSchema.safeParse({ ...REQUEST, keeps }).success).toBe(false);
    }
  });

  it('accept every update kind and reject an unknown one', () => {
    const updates = [
      { type: 'approval_requested', request: REQUEST },
      { type: 'approval_resolved', id: 'approval-1', response: { decision: 'skip' } },
      { type: 'approval_cancelled', id: 'approval-1' },
    ];

    for (const update of updates) expect(approvalUpdateSchema.parse(update)).toEqual(update);
    expect(approvalUpdateSchema.safeParse({ type: 'approval_expired', id: 'a' }).success).toBe(
      false,
    );
  });
});
