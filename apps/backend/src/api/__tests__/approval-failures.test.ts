import { describe, expect, it } from 'vitest';
import { ApprovalRequestError } from '@sheavly/runtime/errors/approvals.errors';
import { toApiFailure } from '../api.utils.js';

describe('how the API answers an approval it cannot take', () => {
  it('says a gone approval is unknown_approval, which a UI forgives as answered elsewhere', () => {
    const gone = new ApprovalRequestError({ reason: 'unknown_id', message: 'No approval waits' });

    expect(toApiFailure(gone)).toEqual({
      status: 404,
      code: 'unknown_approval',
      message: 'No approval waits',
    });
  });

  it('says a decision the request did not offer is a bad request, since the approval still waits', () => {
    const notOffered = new ApprovalRequestError({
      reason: 'not_offered',
      message: 'always_allow is not one of the options offered',
    });

    expect(toApiFailure(notOffered)).toMatchObject({ status: 400, code: 'bad_request' });
  });
});
