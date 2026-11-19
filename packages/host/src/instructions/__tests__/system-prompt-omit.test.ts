import { describe, expect, it } from 'vitest';
import { BASE_INSTRUCTIONS_SECTION } from '@sheavly/extension/instructions/instructions.constants';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import {
  BaseInstructionsConflictError,
  UnknownInstructionSectionError,
} from '../../errors/system-prompt.errors.js';
import { createHarness } from '../../host/host.helper.js';
import { BASE_AGENT_INSTRUCTIONS } from '../instructions.prompt.js';
import { SystemPrompt } from '../system-prompt.service.js';

const ALPHA = { name: 'alpha', text: '# Alpha\nFirst.' };
const BRAVO = { name: 'bravo', text: '# Bravo\nSecond.' };
const CHARLIE = { name: 'charlie', text: '# Charlie\nThird.' };
const REPLACEMENT = { extension: 'replacer', text: '# Mine' };

describe('SystemPrompt leaves out the sections the app omits', () => {
  it('drops an omitted section and keeps the others, the app extras and the order', () => {
    const prompt = new SystemPrompt({ instructions: 'EXTRAS', omitInstructionSections: ['bravo'] });

    prompt.contribute({ sections: [ALPHA, BRAVO, CHARLIE] });

    expect(prompt.text).toBe(
      `${BASE_AGENT_INSTRUCTIONS}\n\n${ALPHA.text}\n\n${CHARLIE.text}\n\nEXTRAS`,
    );
  });

  it('drops two omitted sections', () => {
    const prompt = new SystemPrompt({ omitInstructionSections: ['alpha', 'charlie'] });

    prompt.contribute({ sections: [ALPHA, BRAVO, CHARLIE] });

    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${BRAVO.text}`);
  });

  it('does not apply an omitted replacement: the generic base is used', () => {
    const prompt = new SystemPrompt({ omitInstructionSections: [BASE_INSTRUCTIONS_SECTION] });

    prompt.contribute({ sections: [ALPHA], replacement: REPLACEMENT });

    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${ALPHA.text}`);
  });

  it('uses the app base next to an omitted replacement, with no conflict', () => {
    const prompt = new SystemPrompt({
      baseInstructions: 'APP BASE',
      omitInstructionSections: [BASE_INSTRUCTIONS_SECTION],
    });

    expect(() => prompt.contribute({ sections: [ALPHA], replacement: REPLACEMENT })).not.toThrow();
    expect(prompt.text).toBe(`APP BASE\n\n${ALPHA.text}`);
  });

  it('still refuses an app base next to a replacement that is not omitted, and says how to resolve it', () => {
    const prompt = new SystemPrompt({
      baseInstructions: 'APP BASE',
      omitInstructionSections: ['alpha'],
    });

    expect(() => prompt.contribute({ sections: [ALPHA], replacement: REPLACEMENT })).toThrow(
      BaseInstructionsConflictError,
    );
    expect(() => prompt.contribute({ sections: [ALPHA], replacement: REPLACEMENT })).toThrow(
      new RegExp(
        `omitInstructionSections.*${BASE_INSTRUCTIONS_SECTION}|${BASE_INSTRUCTIONS_SECTION}.*omitInstructionSections`,
      ),
    );
  });

  it('refuses an unknown name with the sorted available names, taking nothing and not using up the call', () => {
    const prompt = new SystemPrompt({ omitInstructionSections: ['bravo', 'bravoo'] });
    const sections = [CHARLIE, ALPHA, BRAVO];
    let thrown: unknown;

    try {
      prompt.contribute({ sections, replacement: REPLACEMENT });
    } catch (caughtError) {
      thrown = caughtError;
    }

    expect(thrown).toBeInstanceOf(UnknownInstructionSectionError);
    expect(thrown).toMatchObject({
      sectionName: 'bravoo',
      available: ['alpha', 'baseInstructions', 'bravo', 'charlie'],
    });
    expect((thrown as Error).message).toMatch(/"bravoo".*alpha, baseInstructions, bravo, charlie/);
    expect(prompt.text).toBe(BASE_AGENT_INSTRUCTIONS);

    const later = new SystemPrompt({ omitInstructionSections: ['bravo'] });

    expect(() => later.contribute({ sections: [ALPHA, BRAVO] })).not.toThrow();
    expect(later.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${ALPHA.text}`);
  });

  it('lets a valid contribute follow a refused one on the same prompt', () => {
    const prompt = new SystemPrompt({ omitInstructionSections: ['bravo'] });

    expect(() => prompt.contribute({ sections: [ALPHA] })).toThrow(UnknownInstructionSectionError);

    prompt.contribute({ sections: [ALPHA, BRAVO] });

    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${ALPHA.text}`);
  });

  it('treats the reserved name as unknown when no replacement was contributed', () => {
    const prompt = new SystemPrompt({ omitInstructionSections: [BASE_INSTRUCTIONS_SECTION] });

    expect(() => prompt.contribute({ sections: [ALPHA] })).toThrow(
      expect.objectContaining({ available: ['alpha'] }),
    );
    expect(() => prompt.contribute({ sections: [ALPHA] })).toThrow(UnknownInstructionSectionError);
  });

  it('says none are available when nothing was contributed', () => {
    const prompt = new SystemPrompt({ omitInstructionSections: ['alpha'] });

    expect(() => prompt.contribute({ sections: [] })).toThrow(/Available: none/);
  });

  it('is harmless to list a name twice', () => {
    const prompt = new SystemPrompt({ omitInstructionSections: ['alpha', 'alpha'] });

    prompt.contribute({ sections: [ALPHA, BRAVO] });

    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${BRAVO.text}`);
  });

  it('reads the same with an empty list as with none', () => {
    const none = new SystemPrompt({ instructions: 'EXTRAS' });
    const empty = new SystemPrompt({ instructions: 'EXTRAS', omitInstructionSections: [] });

    none.contribute({ sections: [ALPHA, BRAVO], replacement: REPLACEMENT });
    empty.contribute({ sections: [ALPHA, BRAVO], replacement: REPLACEMENT });

    expect(empty.text).toBe(none.text);
    expect(empty.text).toBe(`# Mine\n\n${ALPHA.text}\n\n${BRAVO.text}\n\nEXTRAS`);
  });

  it('is given to the prompt by createHarness', () => {
    const harness = createHarness({
      provider: scriptedProvider([]),
      title: 't',
      omitInstructionSections: ['alpha'],
    });

    harness.systemPrompt.contribute({ sections: [ALPHA, BRAVO] });

    expect(harness.instructions).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${BRAVO.text}`);
  });
});
