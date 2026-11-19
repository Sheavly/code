import { describe, expect, it } from 'vitest';
import {
  InvalidOmitInstructionSectionsError,
  UnknownInstructionSectionError,
} from '../../errors/system-prompt.errors.js';
import { BASE_AGENT_INSTRUCTIONS } from '../instructions.prompt.js';
import { SystemPrompt } from '../system-prompt.service.js';

const ALPHA = { name: 'alpha', text: '# Alpha\nFirst.' };
const BRAVO = { name: 'bravo', text: '# Bravo\nSecond.' };

/** A prompt built from a value a plain-JS caller could pass whatever the declared type says. */
function promptWith(omit: unknown): SystemPrompt {
  return new SystemPrompt({ omitInstructionSections: omit as string[] });
}

describe('SystemPrompt validates omitInstructionSections where it enters', () => {
  it.each([
    ['a string', 'ab', 'got string'],
    ['a number', 5, 'got number'],
    ['null', null, 'got null'],
    ['an object', { 0: 'alpha', length: 1 }, 'got object'],
    ['a set', new Set(['alpha']), 'got object'],
    ['a boolean', false, 'got boolean'],
  ])('refuses %s, naming the option', (_what, value, received) => {
    const attempt = () => promptWith(value);

    expect(attempt).toThrow(InvalidOmitInstructionSectionsError);
    expect(attempt).toThrow(/^omitInstructionSections must be an array/);
    expect(attempt).toThrow(received);
  });

  it.each([
    ['a number', [1], 'not-a-string', 'number'],
    ['an object', ['alpha', {}], 'not-a-string', 'object'],
    ['null', [null], 'not-a-string', 'null'],
    ['a nested array', [['alpha']], 'not-a-string', 'an array'],
  ])('refuses an entry that is %s, with its index', (_what, value, problem, received) => {
    const index = value.length - 1;

    expect(() => promptWith(value)).toThrow(
      expect.objectContaining({ detail: { problem, index, received } }),
    );
  });

  it.each([
    ['empty', ''],
    ['spaces', '  '],
    ['whitespace', '\t\n'],
  ])('refuses an entry that is %s, with its index', (_what, entry) => {
    expect(() => promptWith(['alpha', entry])).toThrow(
      expect.objectContaining({ detail: { problem: 'blank', index: 1 } }),
    );
    expect(() => promptWith(['alpha', entry])).toThrow(/entry 1 is blank/);
  });

  it('refuses before anything else, even next to otherwise valid options', () => {
    expect(
      () =>
        new SystemPrompt({ baseInstructions: 'APP', omitInstructionSections: 'alpha' as never }),
    ).toThrow(InvalidOmitInstructionSectionsError);
  });

  it('reads the array once: what was validated is what is used', () => {
    const reads = new Map<string, number>();
    const answers = ['alpha', 7];
    const proxy = new Proxy(['placeholder'], {
      get(target, key, receiver) {
        const name = String(key);

        reads.set(name, (reads.get(name) ?? 0) + 1);

        return key === '0' ? answers.shift() : (Reflect.get(target, key, receiver) as unknown);
      },
    });
    const prompt = promptWith(proxy);

    prompt.contribute({ sections: [ALPHA, BRAVO] });

    expect(reads.get('0')).toBe(1);
    expect(reads.get('length')).toBe(1);
    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${BRAVO.text}`);
  });

  it('does not let a proxy that turns invalid after the first read matter', () => {
    const answers: unknown[] = ['alpha', '', ''];
    const proxy = new Proxy(['x'], {
      get: (target, key, receiver) =>
        key === '0' ? answers.shift() : (Reflect.get(target, key, receiver) as unknown),
    });

    expect(() => promptWith(proxy)).not.toThrow();
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'lets the name %s reach the unknown-name error: it is a string',
    (name) => {
      const prompt = promptWith([name]);

      expect(() => prompt.contribute({ sections: [ALPHA] })).toThrow(
        expect.objectContaining({ sectionName: name, available: ['alpha'] }),
      );
      expect(() => prompt.contribute({ sections: [ALPHA] })).toThrow(
        UnknownInstructionSectionError,
      );
    },
  );

  it('accepts a frozen array and does not change it', () => {
    const omit = Object.freeze(['alpha']);
    const prompt = promptWith(omit);

    prompt.contribute({ sections: [ALPHA, BRAVO] });

    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${BRAVO.text}`);
    expect(omit).toEqual(['alpha']);
  });

  it('is not changed by the caller changing its array afterwards', () => {
    const omit = ['alpha'];
    const prompt = promptWith(omit);

    omit.push('bravo');
    prompt.contribute({ sections: [ALPHA, BRAVO] });

    expect(prompt.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${BRAVO.text}`);
  });

  it('reads undefined and an empty array as no omission, as before', () => {
    const none = new SystemPrompt({});
    const undef = promptWith(undefined);
    const empty = promptWith([]);

    for (const prompt of [none, undef, empty]) prompt.contribute({ sections: [ALPHA, BRAVO] });

    expect(undef.text).toBe(none.text);
    expect(empty.text).toBe(none.text);
    expect(none.text).toBe(`${BASE_AGENT_INSTRUCTIONS}\n\n${ALPHA.text}\n\n${BRAVO.text}`);
  });
});

describe('SystemPrompt checks the omitted names against many sections', () => {
  it('finishes with as many omitted names as contributed sections, and names an unknown one', () => {
    const count = 100_000;
    const sections = Array.from({ length: count }, (_unused, index) => ({
      name: `section-${index}`,
      text: `# ${index}`,
    }));
    const omitted = sections.map(({ name }) => name);
    const known = new SystemPrompt({ omitInstructionSections: omitted });
    const unknown = new SystemPrompt({ omitInstructionSections: [...omitted, 'section-typo'] });

    known.contribute({ sections });

    expect(known.text).toBe(BASE_AGENT_INSTRUCTIONS);
    expect(() => unknown.contribute({ sections })).toThrow(
      expect.objectContaining({ sectionName: 'section-typo' }),
    );
  });
});
