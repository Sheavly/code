import { describe, expect, it } from 'vitest';
import { OUTPUT_REF_LABEL } from '../output.constants.js';
import { findOutputRefs } from '../output.utils.js';
import { outputLogSchema, outputRefSchema } from '../output.validator.js';

const REF = '3f2b8a52-5c0e-4a0e-9a53-8f7f4b1c2d3e';
const OTHER = '9d6c1a52-5c0e-4a0e-9a53-8f7f4b1c2d3e';

describe('outputLogSchema', () => {
  it.each(['capturing', 'complete'])('accepts a %s log without a reason', (status) => {
    const log = { ref: REF, bytes: 4, status };

    expect(outputLogSchema.parse(log)).toEqual(log);
  });

  it('accepts an incomplete log that says what was lost', () => {
    const log = { ref: REF, bytes: 4, status: 'incomplete', reason: 'storage failed' };

    expect(outputLogSchema.parse(log)).toEqual(log);
  });

  it('rejects an incomplete log with no reason', () => {
    expect(outputLogSchema.safeParse({ ref: REF, bytes: 4, status: 'incomplete' }).success).toBe(
      false,
    );
  });

  it.each(['capturing', 'complete'])('rejects a reason on a %s log', (status) => {
    expect(outputLogSchema.safeParse({ ref: REF, bytes: 4, status, reason: 'x' }).success).toBe(
      false,
    );
  });

  it('rejects a negative or fractional byte count and a ref that is not a UUID', () => {
    expect(outputLogSchema.safeParse({ ref: REF, bytes: -1, status: 'complete' }).success).toBe(
      false,
    );
    expect(outputLogSchema.safeParse({ ref: REF, bytes: 1.5, status: 'complete' }).success).toBe(
      false,
    );
    expect(outputRefSchema.safeParse('../etc/passwd').success).toBe(false);
  });
});

describe('findOutputRefs', () => {
  it('finds each reference once, in order of first appearance', () => {
    const text = `a ${OUTPUT_REF_LABEL}${OTHER} b ${OUTPUT_REF_LABEL}${REF} c ${OUTPUT_REF_LABEL}${OTHER}`;

    expect(findOutputRefs(text)).toEqual([OTHER, REF]);
  });

  it('ignores a label with no valid id after it', () => {
    expect(findOutputRefs(`${OUTPUT_REF_LABEL}nope ${OUTPUT_REF_LABEL}`)).toEqual([]);
  });

  it('finds nothing in text without a label', () => {
    expect(findOutputRefs(REF)).toEqual([]);
  });
});
