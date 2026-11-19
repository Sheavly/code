import { describe, expect, it } from 'vitest';
import { ExtensionInstructionError } from '../../errors/instruction.errors.js';
import type { Contributions } from '../../extension/extension.types.js';
import { defineService, hostServiceFor } from '../../extension/extension.utils.js';
import {
  MAX_INSTRUCTION_CHARS,
  SYSTEM_PROMPT_EXTEND_GRANT,
  SYSTEM_PROMPT_REPLACE_GRANT,
} from '../../instructions/instructions.constants.js';
import {
  activateFakes as activate,
  activatePlain,
  onlyFailureCause as onlyFailure,
} from '../../testing/activation.fake.js';
import { fakeExtension, fakeInstruction, fakeTool } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';
import { grantCatalogueOf } from '../grant-catalogue.utils.js';

const signal = new AbortController().signal;
const REPLACE = [SYSTEM_PROMPT_REPLACE_GRANT];
const EXTEND = [SYSTEM_PROMPT_EXTEND_GRANT];

describe('ExtensionHost merges the replacement of the generic base', () => {
  it('exposes the one replacement next to the sections of other extensions', async () => {
    const result = await activate([
      {
        name: 'replacer',
        grants: REPLACE,
        contributes: { baseInstructions: '# My base' },
      },
      {
        name: 'guide',
        grants: EXTEND,
        contributes: { instructions: [fakeInstruction({ name: 's', text: '# Guide' })] },
      },
    ]);

    expect(result.failed).toEqual([]);
    expect(result.contributions.baseInstructions).toBe('# My base');
    expect(result.contributions.instructions).toEqual([{ name: 's', text: '# Guide' }]);
  });

  it('exposes none when no extension replaces the base', async () => {
    const result = await activate([{ name: 'a', contributes: { tools: [fakeTool('t')] } }]);

    expect(result.contributions.baseInstructions).toBeUndefined();
    expect(result.contributions.baseInstructionsBy).toBeUndefined();
  });

  it('names the extension that holds the replacement', async () => {
    const result = await activate([
      { name: 'plain', contributes: { tools: [fakeTool('t')] } },
      { name: 'replacer', grants: REPLACE, contributes: { baseInstructions: '# My base' } },
    ]);

    expect(result.contributions.baseInstructionsBy).toBe('replacer');
  });

  it('merges the replacement of a plain extension defined with a manifest literal', async () => {
    const result = await activatePlain({
      manifest: { name: 'plain', grants: REPLACE },
      contributes: { baseInstructions: '# Plain base' },
    });

    expect(result.failed).toEqual([]);
    expect(result.contributions.baseInstructions).toBe('# Plain base');
  });

  it('accepts a manifest that lists the grant while replacing nothing', async () => {
    const result = await activate([{ name: 'a', grants: REPLACE }]);

    expect(result.failed).toEqual([]);
    expect(result.contributions.baseInstructions).toBeUndefined();
  });

  it('fails an extension without the grant, naming the extension and the grant', async () => {
    const result = await activate([{ name: 'a', contributes: { baseInstructions: '# Base' } }]);

    expect(onlyFailure(result)).toMatchObject({
      name: 'ExtensionUndeclaredError',
      extension: 'a',
      use: 'grant',
      undeclared: SYSTEM_PROMPT_REPLACE_GRANT,
      message: expect.stringContaining('Extension a') as unknown,
    });
    expect(result.contributions.baseInstructions).toBeUndefined();
  });

  it('fails a plain extension without the grant the same way', async () => {
    const result = await activatePlain({
      manifest: { name: 'plain' },
      contributes: { baseInstructions: '# Plain base' },
    });

    expect(onlyFailure(result)).toMatchObject({ extension: 'plain', use: 'grant' });
  });
});

describe('ExtensionHost lets at most one extension replace the base', () => {
  it.each([
    ['first', 'second'],
    ['second', 'first'],
  ])('fails loudly naming both, whichever order (%s listed first)', async (one, two) => {
    const host = new ExtensionHost({
      extensions: [one, two].map((name) =>
        fakeExtension({ name, grants: REPLACE, contributes: { baseInstructions: `# ${name}` } }),
      ),
    });

    await expect(host.activate({ signal })).rejects.toMatchObject({
      name: 'ContributionCollisionError',
      contribution: 'base instructions',
      extensions: [one, two],
    });
  });

  it('lets another extension take the slot once the first one failed to activate', async () => {
    const result = await activate([
      {
        name: 'broken',
        grants: REPLACE,
        activate: () => ({ baseInstructions: '# Broken', tools: [fakeTool('undeclared')] }),
      },
      { name: 'steady', grants: REPLACE, contributes: { baseInstructions: '# Steady' } },
    ]);

    expect(onlyFailure(result)).toMatchObject({ extension: 'broken', use: 'tool' });
    expect(result.contributions.baseInstructions).toBe('# Steady');
  });
});

describe('ExtensionHost checks the text of a replacement base', () => {
  const cases: [string, unknown, string][] = [
    ['longer than the cap', 'x'.repeat(MAX_INSTRUCTION_CHARS + 1), 'too-long'],
    ['empty', '', 'blank'],
    ['blank', ' \n ', 'blank'],
    ['a number', 7, 'not-text'],
    ['null', null, 'not-text'],
  ];

  it.each(cases)('fails an extension whose replacement is %s', async (_what, text, problem) => {
    // A plain-JS extension can return any value: the host must not trust the declared type.
    const contributions: Contributions = { baseInstructions: text as string };
    const result = await activate([{ name: 'a', grants: REPLACE, activate: () => contributions }]);
    const cause = onlyFailure(result);

    expect(cause).toBeInstanceOf(ExtensionInstructionError);
    expect(cause).toMatchObject({ extension: 'a', problem });
    expect((cause as Error).message).toContain('Extension a');
    expect((cause as Error).message).toContain(String(MAX_INSTRUCTION_CHARS));
    expect(result.contributions.baseInstructions).toBeUndefined();
  });

  it('accepts a replacement of exactly the cap', async () => {
    const text = 'x'.repeat(MAX_INSTRUCTION_CHARS);
    const result = await activate([
      { name: 'a', grants: REPLACE, contributes: { baseInstructions: text } },
    ]);

    expect(result.contributions.baseInstructions).toBe(text);
  });

  it('holds the text read at the check, whatever the extension returns later', async () => {
    let reads = 0;
    const contributions: Contributions = {
      get baseInstructions() {
        reads += 1;

        return reads === 1 ? '# First read' : '# Later read';
      },
    };
    const result = await activate([{ name: 'a', grants: REPLACE, activate: () => contributions }]);

    expect(result.contributions.baseInstructions).toBe('# First read');
    expect(reads).toBe(1);
  });
});

describe('the two prompt grants are independent', () => {
  it('does not let the extend grant replace the base', async () => {
    const result = await activate([
      { name: 'a', grants: EXTEND, contributes: { baseInstructions: '# Base' } },
    ]);

    expect(onlyFailure(result)).toMatchObject({
      use: 'grant',
      undeclared: 'system-prompt:replace',
    });
  });

  it('does not let the replace grant add sections', async () => {
    const result = await activate([
      {
        name: 'a',
        grants: REPLACE,
        contributes: { instructions: [fakeInstruction({ name: 's' })] },
      },
    ]);

    expect(onlyFailure(result)).toMatchObject({ use: 'grant', undeclared: 'system-prompt:extend' });
  });

  it('lets one extension hold both grants and use both', async () => {
    const result = await activate([
      {
        name: 'a',
        grants: [...EXTEND, ...REPLACE],
        contributes: {
          baseInstructions: '# Base',
          instructions: [fakeInstruction({ name: 's', text: '# S' })],
        },
      },
    ]);

    expect(result.failed).toEqual([]);
    expect(result.contributions.baseInstructions).toBe('# Base');
    expect(result.contributions.instructions).toEqual([{ name: 's', text: '# S' }]);
  });
});

describe('the host offers the prompt grants without a service', () => {
  const TASKS = defineService<object>('background-tasks');
  const supplied = [
    hostServiceFor({ key: TASKS, grants: ['task:start'], create: () => ({ value: {} }) }),
  ];

  it.each([...EXTEND, ...REPLACE])(
    'knows %s with no service supplied, so a manifest listing it does not fail',
    async (grant) => {
      expect(grantCatalogueOf([]).has(grant)).toBe(true);

      const result = await activate([{ name: 'a', grants: [grant] }]);

      expect(result.failed).toEqual([]);
    },
  );

  it('accepts the grants next to a service grant the extension reads, and refuses a typo', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'ok',
          requires: [TASKS.name],
          grants: ['task:start', ...EXTEND, ...REPLACE],
        }),
        fakeExtension({ name: 'typo', grants: ['system-prompt:extens'] }),
      ],
      services: supplied,
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['ok']);
    expect(result.failed[0]?.cause).toMatchObject({
      extension: 'typo',
      grant: 'system-prompt:extens',
    });
  });
});
