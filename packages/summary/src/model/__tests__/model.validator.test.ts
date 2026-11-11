import { describe, expect, it } from 'vitest';
import { SummaryReplyError } from '../../errors/summary.errors.js';
import { defaultModelSections } from '../summary.prompt.js';
import { parseSectionReply } from '../model.validator.js';

const parse = (reply: string) =>
  parseSectionReply({ summarizer: 'model', reply, sections: defaultModelSections() });

describe('parseSectionReply', () => {
  it('reads a JSON object of section texts, trimmed', () => {
    const written = parse('{"goal": "  Fix the total. ", "state": "Done."}');

    expect([...written]).toEqual([
      ['goal', 'Fix the total.'],
      ['state', 'Done.'],
    ]);
  });

  it('accepts the object inside a code fence the model added', () => {
    expect(parse('```json\n{"goal": "Fix it."}\n```').get('goal')).toBe('Fix it.');
  });

  it('ignores a key that was not asked for, and a section left empty', () => {
    const written = parse('{"goal": "Fix it.", "other": "x", "state": "  "}');

    expect([...written.keys()]).toEqual(['goal']);
  });

  it.each([
    ['text that is not JSON', 'Here is the summary: …'],
    ['a JSON array', '["goal"]'],
    ['values that are not text', '{"goal": 5}'],
    ['an object with none of the asked-for sections', '{"other": "x"}'],
    ['nothing', ''],
  ])('refuses %s with a typed error', (_name, reply) => {
    expect(() => parse(reply)).toThrow(SummaryReplyError);
  });

  it('never quotes the reply in the error, which is model-written text', () => {
    let failure: unknown;

    try {
      parse('sk-secretsecretsecretsecret is not JSON');
    } catch (caughtError) {
      failure = caughtError;
    }

    expect(failure).toBeInstanceOf(SummaryReplyError);
    expect(failure instanceof Error && failure.message).not.toContain('secretsecret');
  });
});
