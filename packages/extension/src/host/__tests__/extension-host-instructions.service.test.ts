import { describe, expect, it } from 'vitest';
import { ExtensionInstructionError } from '../../errors/instruction.errors.js';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import type { InstructionContribution } from '../../extension/extension.types.js';
import {
  BASE_INSTRUCTIONS_SECTION,
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

const signal = new AbortController().signal;
const GRANTED = [SYSTEM_PROMPT_EXTEND_GRANT];

describe('ExtensionHost merges the instruction sections of its extensions', () => {
  it('exposes the sections in activation order across two extensions', async () => {
    const result = await activate([
      {
        name: 'second',
        dependsOn: ['first'],
        grants: GRANTED,
        contributes: { instructions: [fakeInstruction({ name: 'two', text: '# Two' })] },
      },
      {
        name: 'first',
        grants: GRANTED,
        contributes: {
          instructions: [
            fakeInstruction({ name: 'one', text: '# One' }),
            fakeInstruction({ name: 'one-b', text: '# One b' }),
          ],
        },
      },
    ]);

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['first', 'second']);
    expect(result.contributions.instructions).toEqual([
      { name: 'one', text: '# One' },
      { name: 'one-b', text: '# One b' },
      { name: 'two', text: '# Two' },
    ]);
  });

  it('merges a section of a plain extension defined with a manifest literal', async () => {
    const result = await activatePlain({
      manifest: { name: 'plain', grants: GRANTED, instructions: ['plain-guidance'] },
      contributes: { instructions: [{ name: 'plain-guidance', text: '# Plain' }] },
    });

    expect(result.failed).toEqual([]);
    expect(result.contributions.instructions).toEqual([
      { name: 'plain-guidance', text: '# Plain' },
    ]);
  });

  it('adds no header or separator: the text is held byte for byte', async () => {
    const text = '  no heading, trailing space \n';
    const result = await activate([
      { name: 'a', grants: GRANTED, contributes: { instructions: [{ name: 's', text }] } },
    ]);

    expect(result.contributions.instructions[0]?.text).toBe(text);
  });

  it('exposes none when no extension contributes any', async () => {
    const result = await activate([{ name: 'a', contributes: { tools: [fakeTool('t')] } }]);

    expect(result.contributions.instructions).toEqual([]);
  });

  it('accepts a manifest that lists the grant while contributing no sections', async () => {
    const result = await activate([{ name: 'a', grants: GRANTED, instructions: ['unused'] }]);

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['a']);
  });

  it('accepts an empty instructions list without the grant', async () => {
    const result = await activate([{ name: 'a', activate: () => ({ instructions: [] }) }]);

    expect(result.failed).toEqual([]);
  });
});

describe('ExtensionHost holds instruction sections to the manifest and the grant', () => {
  it('fails an extension that contributes a section its manifest does not declare', async () => {
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['declared'],
        activate: () => ({ instructions: [fakeInstruction({ name: 'extra' })] }),
      },
    ]);
    const cause = onlyFailure(result);

    expect(cause).toBeInstanceOf(ExtensionUndeclaredError);
    expect(cause).toMatchObject({ extension: 'a', use: 'instruction', undeclared: 'extra' });
    expect((cause as Error).message).toContain('add it to instructions');
    expect(result.contributions.instructions).toEqual([]);
  });

  it('does not accept a wildcard-looking name as covering another section', async () => {
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['notes-guidance'],
        activate: () => ({ instructions: [fakeInstruction({ name: 'notes-other' })] }),
      },
    ]);

    expect(onlyFailure(result)).toMatchObject({ use: 'instruction', undeclared: 'notes-other' });
  });

  it('fails an extension without the grant, naming the extension and the grant', async () => {
    const log: string[] = [];
    const result = await activate([
      {
        name: 'a',
        contributes: { instructions: [fakeInstruction({ name: 'one' })] },
        deactivate: () => void log.push('a deactivated'),
      },
      { name: 'child', dependsOn: ['a'] },
    ]);
    const cause = onlyFailure(result);

    expect(cause).toBeInstanceOf(ExtensionUndeclaredError);
    expect(cause).toMatchObject({
      extension: 'a',
      use: 'grant',
      undeclared: SYSTEM_PROMPT_EXTEND_GRANT,
    });
    expect((cause as Error).message).toContain('Extension a');
    expect((cause as Error).message).toContain('"system-prompt:extend"');
    expect(result.contributions.instructions).toEqual([]);
    expect(result.skipped).toEqual([{ extension: 'child', reason: 'dependency' }]);
    expect(log).toEqual(['a deactivated']);
  });

  it('refuses the grant of another extension: each manifest is held to its own', async () => {
    const result = await activate([
      {
        name: 'granted',
        grants: GRANTED,
        contributes: { instructions: [fakeInstruction({ name: 'g' })] },
      },
      { name: 'bare', contributes: { instructions: [fakeInstruction({ name: 'b' })] } },
    ]);

    expect(onlyFailure(result)).toMatchObject({ extension: 'bare', use: 'grant' });
    expect(result.contributions.instructions.map((section) => section.name)).toEqual(['g']);
  });

  it('fails the same way for a plain extension without the grant', async () => {
    const result = await activatePlain({
      manifest: { name: 'plain', instructions: ['guidance'] },
      contributes: { instructions: [{ name: 'guidance', text: '# Plain' }] },
    });

    expect(onlyFailure(result)).toMatchObject({ extension: 'plain', use: 'grant' });
  });

  it('fails loudly when two extensions contribute one name, naming both', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'first',
          grants: GRANTED,
          contributes: { instructions: [fakeInstruction({ name: 'shared' })] },
        }),
        fakeExtension({
          name: 'second',
          grants: GRANTED,
          contributes: { instructions: [fakeInstruction({ name: 'shared' })] },
        }),
      ],
    });

    await expect(host.activate({ signal })).rejects.toMatchObject({
      name: 'ContributionCollisionError',
      contribution: 'instruction',
      contributionName: 'shared',
      extensions: ['first', 'second'],
    });
  });
});

describe('ExtensionHost checks the text of a section', () => {
  const cases: [string, unknown, string][] = [
    ['longer than the cap', 'x'.repeat(MAX_INSTRUCTION_CHARS + 1), 'too-long'],
    ['empty', '', 'blank'],
    ['blank', ' \n\t ', 'blank'],
    ['a number', 42, 'not-text'],
    ['missing', undefined, 'not-text'],
    ['null', null, 'not-text'],
  ];

  it.each(cases)('fails an extension whose text is %s', async (_what, text, problem) => {
    // A plain-JS extension can return any text: the host must not trust the declared type.
    const section: InstructionContribution = { name: 's', text: text as string };
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['s'],
        activate: () => ({ instructions: [section] }),
      },
    ]);
    const cause = onlyFailure(result);

    expect(cause).toBeInstanceOf(ExtensionInstructionError);
    expect(cause).toMatchObject({ extension: 'a', section: 's', problem });
    expect((cause as Error).message).toContain('Extension a');
    expect((cause as Error).message).toContain('"s"');
    expect((cause as Error).message).toContain(String(MAX_INSTRUCTION_CHARS));
    expect(result.contributions.instructions).toEqual([]);
  });

  it('accepts a text of exactly the cap', async () => {
    const text = 'x'.repeat(MAX_INSTRUCTION_CHARS);
    const result = await activate([
      { name: 'a', grants: GRANTED, contributes: { instructions: [{ name: 's', text }] } },
    ]);

    expect(result.failed).toEqual([]);
    expect(result.contributions.instructions).toEqual([{ name: 's', text }]);
  });

  it('contributes none of the sections of an extension whose activation failed', async () => {
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['good', 'bad'],
        activate: () => ({
          instructions: [
            fakeInstruction({ name: 'good' }),
            { name: 'bad', text: 'x'.repeat(MAX_INSTRUCTION_CHARS + 1) },
          ],
        }),
      },
      {
        name: 'fine',
        grants: GRANTED,
        contributes: { instructions: [fakeInstruction({ name: 'kept' })] },
      },
    ]);

    expect(onlyFailure(result)).toBeInstanceOf(ExtensionInstructionError);
    expect(result.contributions.instructions.map((section) => section.name)).toEqual(['kept']);
  });

  it('contributes none of the sections of an extension whose activate threw', async () => {
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['one'],
        activate: () => {
          throw new Error('boom');
        },
      },
    ]);

    expect(result.failed).toHaveLength(1);
    expect(result.contributions.instructions).toEqual([]);
  });
});

describe('ExtensionHost reserves the replacement-base label', () => {
  const reserved = { name: BASE_INSTRUCTIONS_SECTION, text: '# Spoof' };

  it('fails a fake that contributes a section with the reserved name, merging nothing', async () => {
    const result = await activate([
      {
        name: 'spoof',
        grants: GRANTED,
        // The manifest schema refuses the label, so the section is undeclared: the reserved name
        // is still what the host reports.
        instructions: ['other'],
        activate: () => ({ instructions: [fakeInstruction({ name: 'other' }), reserved] }),
      },
      {
        name: 'fine',
        grants: GRANTED,
        contributes: { instructions: [fakeInstruction({ name: 'kept' })] },
      },
    ]);
    const cause = onlyFailure(result);

    expect(cause).toBeInstanceOf(ExtensionInstructionError);
    expect(cause).toMatchObject({
      extension: 'spoof',
      section: BASE_INSTRUCTIONS_SECTION,
      problem: 'reserved',
    });
    expect((cause as Error).message).toContain('Extension spoof');
    expect((cause as Error).message).toContain(`"${BASE_INSTRUCTIONS_SECTION}"`);
    expect((cause as Error).message).toContain('reserved');
    expect(result.contributions.instructions.map((section) => section.name)).toEqual(['kept']);
  });

  it('fails a plain extension the same way', async () => {
    const result = await activatePlain({
      manifest: { name: 'plain', grants: GRANTED, instructions: ['other'] },
      contributes: { instructions: [reserved] },
    });

    expect(onlyFailure(result)).toMatchObject({ extension: 'plain', problem: 'reserved' });
    expect(result.contributions.instructions).toEqual([]);
  });

  it('still accepts a section with another name, and the label as the replacement slot', async () => {
    const near = { name: 'baseInstructions2', text: '# Two' };
    const result = await activatePlain({
      manifest: {
        name: 'both',
        grants: [SYSTEM_PROMPT_EXTEND_GRANT, SYSTEM_PROMPT_REPLACE_GRANT],
        instructions: [near.name],
      },
      contributes: { baseInstructions: '# Slot', instructions: [near] },
    });

    expect(result.failed).toEqual([]);
    expect(result.contributions.baseInstructions).toBe('# Slot');
    expect(result.contributions.instructions).toEqual([near]);
  });
});

describe('ExtensionHost holds frozen copies of the sections', () => {
  it('freezes the list and each section', async () => {
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        contributes: { instructions: [fakeInstruction({ name: 's' })] },
      },
    ]);
    const [section] = result.contributions.instructions;

    expect(Object.isFrozen(result.contributions.instructions)).toBe(true);
    expect(Object.isFrozen(section)).toBe(true);
  });

  it('is not changed by the extension mutating its own objects and list afterwards', async () => {
    const section: InstructionContribution = { name: 's', text: '# Original' };
    const own: InstructionContribution[] = [section];
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['s', 'late'],
        activate: () => ({ instructions: own }),
      },
    ]);

    section.text = '# Changed';
    section.name = 'renamed';
    own.push({ name: 'late', text: '# Late' });

    expect(result.contributions.instructions).toEqual([{ name: 's', text: '# Original' }]);
  });

  it('is not the extension’s own object', async () => {
    const own: InstructionContribution = { name: 's', text: '# Original' };
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['s'],
        activate: () => ({ instructions: [own] }),
      },
    ]);

    expect(result.contributions.instructions[0]).not.toBe(own);
    expect(Object.isFrozen(own)).toBe(false);
  });

  it('fails an extension whose list changes before the merge, like any other contribution', async () => {
    const own: InstructionContribution[] = [{ name: 's', text: '# Original' }];
    const result = await activate([
      {
        name: 'a',
        grants: GRANTED,
        instructions: ['s', 'late'],
        activate: () => ({ instructions: own }),
      },
      {
        name: 'later',
        activate: () => {
          own.push({ name: 'late', text: '# Late' });

          return {};
        },
      },
    ]);

    expect(onlyFailure(result)).toMatchObject({ contribution: 'instruction' });
    expect(result.contributions.instructions).toEqual([]);
  });
});
