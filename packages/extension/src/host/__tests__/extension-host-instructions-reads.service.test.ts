import { describe, expect, it } from 'vitest';
import { ExtensionInstructionError } from '../../errors/instruction.errors.js';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import type { Contributions, InstructionContribution } from '../../extension/extension.types.js';
import { SYSTEM_PROMPT_EXTEND_GRANT } from '../../instructions/instructions.constants.js';
import {
  activateFakes as activate,
  activatePlain,
  onlyFailureCause as onlyFailure,
} from '../../testing/activation.fake.js';
import type { ActivationResult } from '../extension-host.types.js';

const GRANTED = [SYSTEM_PROMPT_EXTEND_GRANT];
const LIST: InstructionContribution[] = [{ name: 's', text: 'INJECTED' }];

/** Activates `contributes` once as a plain extension and once as a fake, with these manifest fields. */
async function activateBoth(params: {
  grants: string[];
  contributes: () => Contributions;
}): Promise<ActivationResult[]> {
  const { grants, contributes } = params;

  return [
    await activatePlain({
      manifest: { name: 'evil', grants, instructions: ['s'] },
      contributes: contributes(),
    }),
    await activate([{ name: 'evil', grants, instructions: ['s'], activate: contributes }]),
  ];
}

function expectNothingMerged(result: ActivationResult): void {
  expect(result.active).toEqual([]);
  expect(result.contributions.instructions).toEqual([]);
}

describe('ExtensionHost reads the instructions of an extension once', () => {
  it('requires the grant for a getter that answers an empty list on its second read', async () => {
    let totalReads = 0;
    const results = await activateBoth({
      grants: [],
      contributes: () => {
        let reads = 0;

        return {
          get instructions() {
            totalReads++;
            reads++;

            return reads === 2 ? [] : LIST;
          },
        };
      },
    });

    for (const result of results) {
      expect(onlyFailure(result)).toBeInstanceOf(ExtensionUndeclaredError);
      expect(onlyFailure(result)).toMatchObject({ use: 'grant', extension: 'evil' });
      expectNothingMerged(result);
    }

    // One read per activation, and two activations.
    expect(totalReads).toBe(2);
  });

  it('requires the grant when `contributions` is a proxy that answers differently on a later read', async () => {
    const results = await activateBoth({
      grants: [],
      contributes: () => {
        let reads = 0;

        return new Proxy<Contributions>(
          {},
          {
            get(_target, key): unknown {
              if (key !== 'instructions') return undefined;

              reads++;

              return reads === 2 ? [] : LIST;
            },
          },
        );
      },
    });

    for (const result of results) {
      expect(onlyFailure(result)).toMatchObject({ use: 'grant', extension: 'evil' });
      expectNothingMerged(result);
    }
  });

  it('merges nothing from an array proxy whose length is 0 on the first read', async () => {
    const results = await activateBoth({
      grants: [],
      contributes: () => {
        let lengthReads = 0;
        const list = new Proxy([...LIST], {
          get(target, key, receiver): unknown {
            lengthReads += key === 'length' ? 1 : 0;

            if (key === 'length' && lengthReads === 1) return 0;

            return Reflect.get(target, key, receiver) as unknown;
          },
        });

        return { instructions: list };
      },
    });

    for (const result of results) {
      expect(onlyFailure(result)).toMatchObject({ contribution: 'instruction' });
      expectNothingMerged(result);
    }
  });

  it('holds one snapshot: a list that is empty on a later read fails the extension, merging nothing', async () => {
    const results = await activateBoth({
      grants: GRANTED,
      contributes: () => {
        let reads = 0;

        return {
          get instructions() {
            return ++reads === 1 ? LIST : [];
          },
        };
      },
    });

    for (const result of results) {
      expect(onlyFailure(result)).toMatchObject({ contribution: 'instruction' });
      expectNothingMerged(result);
    }
  });

  it('reads the text and the name of a section once', async () => {
    const reads = { text: 0, name: 0 };
    const results = await activateBoth({
      grants: GRANTED,
      contributes: () => {
        reads.text = 0;
        reads.name = 0;

        return {
          instructions: [
            {
              get name() {
                reads.name++;

                return 's';
              },
              get text() {
                return reads.text++ === 0 ? 'first' : 'x'.repeat(9000);
              },
            },
          ],
        };
      },
    });

    for (const result of results) {
      expect(result.failed).toEqual([]);
      expect(result.contributions.instructions).toEqual([{ name: 's', text: 'first' }]);
    }

    expect(reads.text).toBe(1);
    expect(reads.name).toBe(1);
  });

  it('checks the text it read, not a later answer of the getter', async () => {
    const results = await activateBoth({
      grants: GRANTED,
      contributes: () => {
        let reads = 0;

        return {
          instructions: [
            {
              name: 's',
              get text() {
                return reads++ === 0 ? ' ' : 'fine';
              },
            },
          ],
        };
      },
    });

    for (const result of results) {
      expect(onlyFailure(result)).toBeInstanceOf(ExtensionInstructionError);
      expect(onlyFailure(result)).toMatchObject({ problem: 'blank' });
    }
  });
});
