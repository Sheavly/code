import { describe, expect, it } from 'vitest';
import { callIdSchema } from '../../message/message.validator.js';
import { sessionIdSchema } from '../session.validator.js';
import { isMainSession } from '../session.utils.js';

const MAIN = sessionIdSchema.parse('main');

describe('isMainSession', () => {
  it('is true for the main session and false for a sub-agent', () => {
    expect(isMainSession({ id: MAIN, rootId: MAIN, depth: 1 })).toBe(true);
    expect(
      isMainSession({
        id: sessionIdSchema.parse('child'),
        rootId: MAIN,
        parentId: MAIN,
        startedByCall: callIdSchema.parse('call'),
        depth: 2,
      }),
    ).toBe(false);
  });
});
