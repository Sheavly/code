import { describe, expect, it } from 'vitest';
import { joinInstructions } from '@sheavly/extension/instructions/instructions.utils';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import {
  BaseInstructionsConflictError,
  SystemPromptAlreadyContributedError,
} from '../../errors/system-prompt.errors.js';
import { createHarness } from '../../host/host.helper.js';
import { composeInstructions } from '../instructions.helper.js';
import { BASE_AGENT_INSTRUCTIONS } from '../instructions.prompt.js';
import { SystemPrompt } from '../system-prompt.service.js';

const SECTION = { name: 'guide', text: '# Guide\nDo the guided thing.' };
const OTHER = { name: 'other', text: '  # Other\nMore.\n' };

/**
 * What the app composed before extensions contributed: its own guidance and the extras joined,
 * then the base in front. Written out here, not taken from the code under test.
 */
function composedBefore(params: {
  base: string;
  section?: string | undefined;
  extras?: string | undefined;
}): string {
  const { base, section, extras } = params;

  return joinInstructions([base, joinInstructions([section, extras])]);
}

function promptWith(params: {
  baseInstructions?: string | undefined;
  instructions?: string | undefined;
  sections?: (typeof SECTION)[];
  replacement?: string | undefined;
}): string {
  const { sections = [], replacement } = params;
  const prompt = new SystemPrompt(params);

  prompt.contribute({
    sections,
    ...(replacement !== undefined && { replacement: { extension: 'replacer', text: replacement } }),
  });

  return prompt.text;
}

describe('SystemPrompt reads what the app composed before extensions contributed', () => {
  it('is the generic base when nothing else is given', () => {
    expect(promptWith({})).toBe(composedBefore({ base: BASE_AGENT_INSTRUCTIONS }));
  });

  it('puts the app extras after the base', () => {
    expect(promptWith({ instructions: ' EXTRAS ' })).toBe(
      composedBefore({ base: BASE_AGENT_INSTRUCTIONS, extras: 'EXTRAS' }),
    );
  });

  it('puts a section between the base and the extras, with no sections of its own header', () => {
    expect(promptWith({ sections: [SECTION], instructions: 'EXTRAS' })).toBe(
      composedBefore({ base: BASE_AGENT_INSTRUCTIONS, section: SECTION.text, extras: 'EXTRAS' }),
    );
    expect(promptWith({ sections: [SECTION] })).toBe(
      `${BASE_AGENT_INSTRUCTIONS}\n\n${SECTION.text}`,
    );
  });

  it('keeps activation order and trims each section', () => {
    expect(promptWith({ sections: [SECTION, OTHER] })).toBe(
      `${BASE_AGENT_INSTRUCTIONS}\n\n${SECTION.text}\n\n# Other\nMore.`,
    );
  });

  it('uses the app’s replaced base', () => {
    expect(
      promptWith({ baseInstructions: 'CUSTOM', sections: [SECTION], instructions: 'EXTRAS' }),
    ).toBe(composedBefore({ base: 'CUSTOM', section: SECTION.text, extras: 'EXTRAS' }));
  });

  it('omits the core for an empty-string app base, keeping the sections', () => {
    expect(promptWith({ baseInstructions: '', sections: [SECTION], instructions: 'EXTRAS' })).toBe(
      composedBefore({ base: '', section: SECTION.text, extras: 'EXTRAS' }),
    );
    expect(promptWith({ baseInstructions: '', sections: [SECTION] })).toBe(SECTION.text);
  });

  it('puts an extension’s replacement where the generic base was, before sections and extras', () => {
    expect(promptWith({ replacement: '# Mine', sections: [SECTION], instructions: 'EXTRAS' })).toBe(
      composedBefore({ base: '# Mine', section: SECTION.text, extras: 'EXTRAS' }),
    );
  });

  it('refuses a replacement when the app passed its own base, naming the extension', () => {
    const prompt = new SystemPrompt({ baseInstructions: 'APP BASE', instructions: 'EXTRAS' });

    expect(() =>
      prompt.contribute({
        sections: [SECTION],
        replacement: { extension: 'replacer', text: '# Mine' },
      }),
    ).toThrow(BaseInstructionsConflictError);
    expect(() =>
      prompt.contribute({ sections: [], replacement: { extension: 'replacer', text: '# Mine' } }),
    ).toThrow(/Extension "replacer"/);
    // Nothing of the refused contribution is taken.
    expect(prompt.text).toBe('APP BASE\n\nEXTRAS');
  });

  it('refuses a replacement even when the app’s own base is the empty string', () => {
    const prompt = new SystemPrompt({ baseInstructions: '' });

    expect(() =>
      prompt.contribute({ sections: [], replacement: { extension: 'replacer', text: '# Mine' } }),
    ).toThrow(BaseInstructionsConflictError);
  });

  it('equals composeInstructions for every input when nothing was contributed', () => {
    const bases = [undefined, '', '  ', 'CUSTOM', ' CUSTOM \n'];
    const extras = [undefined, '', ' \n ', 'EXTRAS', '\nEXTRAS\n'];

    for (const baseInstructions of bases) {
      for (const instructions of extras) {
        const options = { baseInstructions, instructions };
        const prompt = new SystemPrompt(options);

        expect(prompt.text).toBe(composeInstructions(options));
        prompt.contribute({ sections: [] });
        expect(prompt.text).toBe(composeInstructions(options));
      }
    }
  });
});

describe('SystemPrompt takes a contribution once, as frozen copies', () => {
  it('is not changed by the caller mutating its sections afterwards', () => {
    const prompt = new SystemPrompt({});
    const section = { name: 'guide', text: '# Guide' };
    const sections = [section];

    prompt.contribute({ sections });
    const before = prompt.text;

    section.text = '# Changed';
    section.name = 'renamed';
    sections.push({ name: 'late', text: '# Late' });

    expect(prompt.text).toBe(before);
    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n# Guide`);
  });

  it('refuses a second contribution and keeps the first', () => {
    const prompt = new SystemPrompt({});

    prompt.contribute({ sections: [SECTION] });

    expect(() => prompt.contribute({ sections: [OTHER] })).toThrow(
      SystemPromptAlreadyContributedError,
    );
    expect(() => prompt.contribute({ sections: [] })).toThrow(/once/);
    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${SECTION.text}`);
  });

  it('does not count a refused contribution as the one call', () => {
    const prompt = new SystemPrompt({ baseInstructions: 'APP BASE' });

    expect(() =>
      prompt.contribute({ sections: [], replacement: { extension: 'replacer', text: '# Mine' } }),
    ).toThrow(BaseInstructionsConflictError);

    prompt.contribute({ sections: [SECTION] });

    expect(prompt.text).toBe(`APP BASE\n\n${SECTION.text}`);
  });
});

describe('the harness reads its system prompt live', () => {
  it('shows a reader before the contribution and one after the composed text', () => {
    const harness = createHarness({
      provider: scriptedProvider([]),
      title: 'live',
      instructions: 'EXTRAS',
    });
    const before = harness.instructions;

    harness.systemPrompt.contribute({ sections: [SECTION] });

    expect(before).toBe(composedBefore({ base: BASE_AGENT_INSTRUCTIONS, extras: 'EXTRAS' }));
    expect(harness.instructions).toBe(
      composedBefore({ base: BASE_AGENT_INSTRUCTIONS, section: SECTION.text, extras: 'EXTRAS' }),
    );
  });

  it('is exactly what composeInstructions returns for a harness nothing contributed to', () => {
    const options = { baseInstructions: 'CUSTOM', instructions: 'EXTRAS' };
    const harness = createHarness({ provider: scriptedProvider([]), title: 't', ...options });

    expect(harness.instructions).toBe(composeInstructions(options));
  });
});
