import { describe, expectTypeOf, it } from 'vitest';
import { verifyServer } from '@sheavly/client/client/verify.helper';
import type { VerifyResult } from '@sheavly/client/client/verify.types';
import type {
  FinderVerify,
  FinderVerifyResult,
} from '@sheavly/storage/server-finder/server-finder.types';

describe('the handshake the finder is given', () => {
  it('is the client’s verifyServer: a drift between the two types fails here', () => {
    expectTypeOf(verifyServer).toExtend<FinderVerify>();
    expectTypeOf<VerifyResult>().toEqualTypeOf<FinderVerifyResult>();
  });
});
