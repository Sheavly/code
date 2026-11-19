import { describe, expect, it } from 'vitest';
import { createHarness } from '@sheavly/host/host/host.helper';
import { composeInstructions } from '@sheavly/host/instructions/instructions.helper';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { composeCodingInstructions } from '../coding-instructions.helper.js';
import { CODING_INSTRUCTIONS } from '../coding-instructions.prompt.js';

describe('composeCodingInstructions', () => {
  it.each([undefined, '', 'HOST', '  HOST  '])(
    'is byte-identical to composing the coding guidance with %j directly',
    (instructions) => {
      expect(composeCodingInstructions({ instructions })).toBe(
        composeInstructions({ baseInstructions: CODING_INSTRUCTIONS, instructions }),
      );
    },
  );

  it.each([undefined, '', 'REPLACEMENT'])(
    'keeps coding guidance before host extras with core replacement %j',
    (baseInstructions) => {
      const harness = createHarness({
        provider: routedProvider({ hi: [say('hello')] }),
        title: 'hi',
        baseInstructions,
        instructions: composeCodingInstructions({ instructions: 'HOST' }),
      });

      expect(harness.instructions.endsWith(`${CODING_INSTRUCTIONS}\n\nHOST`)).toBe(true);
      expect(harness.instructions.split(CODING_INSTRUCTIONS)).toHaveLength(2);
      expect(harness.instructions).toContain('Do not read .env or credential files');

      if (baseInstructions !== undefined) {
        expect(harness.instructions).toBe(
          [baseInstructions, CODING_INSTRUCTIONS, 'HOST'].filter(Boolean).join('\n\n'),
        );
      }
    },
  );
});
