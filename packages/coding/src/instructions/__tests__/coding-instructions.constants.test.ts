import { describe, expect, expectTypeOf, it } from 'vitest';
import { CODING_INSTRUCTIONS } from '@sheavly/coding/instructions/coding-instructions.constants';
import { CODING_INSTRUCTIONS as CODING_PROMPT } from '../coding-instructions.prompt.js';

describe('public coding instructions', () => {
  it('preserves the public constant value and literal type while the prompt stays internal', () => {
    expect(CODING_INSTRUCTIONS).toBe(CODING_PROMPT);
    expectTypeOf(CODING_INSTRUCTIONS).toEqualTypeOf<typeof CODING_PROMPT>();
  });
});
