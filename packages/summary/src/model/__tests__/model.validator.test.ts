import { describe, expect, it } from 'vitest';
import { SummaryReplyError } from '../../errors/summary.errors.js';
import { defaultModelSections } from '../summary.prompt.js';
import { parseSectionReply } from '../model.validator.js';

const parse = (reply: string) =>
  parseSectionReply({ summarizer: 'model', reply, sections: defaultModelSections() });

describe('parseSectionReply by heading', () => {
  it('reads the text under each section heading, trimmed, and attaches no structure of its own', () => {
    const written = parse('## Goal\n  Fix the total. \n\n## Task state\nDone.');

    expect([...written]).toEqual([
      ['goal', 'Fix the total.'],
      ['state', 'Done.'],
    ]);
  });

  it('keeps lists, quotes, code and braces as ordinary text', () => {
    const written = parse(
      '## Key knowledge\n- run `npm test`\n- the file is "src/a.ts"\n{ not: json }\n\n## What failed\n1. tried X\n2. tried Y',
    );

    expect(written.get('knowledge')).toBe(
      '- run `npm test`\n- the file is "src/a.ts"\n{ not: json }',
    );
    expect(written.get('failures')).toBe('1. tried X\n2. tried Y');
  });

  it('accepts the heading styles a model uses: bold, other levels, a colon, any case, the id', () => {
    const written = parse('**Goal**\nOne.\n\n### active constraints:\nTwo.\n\n# STATE\nThree.');

    expect([...written]).toEqual([
      ['goal', 'One.'],
      ['constraints', 'Two.'],
      ['state', 'Three.'],
    ]);
  });

  it('ignores chatter before the first heading and a code fence around everything', () => {
    expect(parse('Here is the summary:\n\n## Goal\nFix it.').get('goal')).toBe('Fix it.');
    expect(parse('```markdown\n## Goal\nFix it.\n```').get('goal')).toBe('Fix it.');
  });

  it('keeps a heading that names no asked-for section as part of the text above it', () => {
    const written = parse('## Goal\nFix it.\n\n## Notes\nSomething else.');

    expect(written.get('goal')).toBe('Fix it.\n\n## Notes\nSomething else.');
    expect([...written.keys()]).toEqual(['goal']);
  });

  it('leaves out a section with nothing under its heading', () => {
    const written = parse('## Goal\nFix it.\n\n## Task state\n  \n');

    expect([...written.keys()]).toEqual(['goal']);
  });

  it('joins a section written under its heading twice', () => {
    expect(parse('## Goal\nOne.\n## Task state\nS.\n## Goal\nTwo.').get('goal')).toBe('One.\nTwo.');
  });

  it('never splits inside a code fence: a heading-like line there is text', () => {
    const written = parse(
      '## Goal\nFix it, like this:\n```md\n## Task state\nnot a heading\n```\nthen stop.\n\n## Task state\nReal.',
    );

    expect(written.get('goal')).toBe(
      'Fix it, like this:\n```md\n## Task state\nnot a heading\n```\nthen stop.',
    );
    expect(written.get('state')).toBe('Real.');
  });

  it('reads a very long line in linear time and never as a heading', () => {
    const long = `# ${' '.repeat(2_000_000)}x`;
    const started = performance.now();
    const written = parse(`## Goal\nFix it.\n${long}\nmore`);

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(written.get('goal')).toContain('more');
  });

  it('matches a title with marks in it, and one written with different spacing', () => {
    const sections = [{ id: 'cs', title: 'C# notes', guidance: 'x' }];
    const written = parseSectionReply({
      summarizer: 'model',
      reply: '##   C#   notes  \nText.',
      sections,
    });

    expect(written.get('cs')).toBe('Text.');
  });

  it('does not take a line that merely mentions a title for its heading', () => {
    const written = parse('## Goal\nThe Goal is to fix the total.\nGoal\nstill text');

    expect(written.get('goal')).toBe('The Goal is to fix the total.\nGoal\nstill text');
  });
});

describe('parseSectionReply by JSON, when a model answers in it anyway', () => {
  it('reads a JSON object of section texts, and a list of text as lines', () => {
    const written = parse('{"goal": "  Fix the total. ", "state": ["Done.", "Next."], "x": "y"}');

    expect([...written]).toEqual([
      ['goal', 'Fix the total.'],
      ['state', 'Done.\nNext.'],
    ]);
  });

  it('reads the object inside a code fence', () => {
    expect(parse('```json\n{"goal": "Fix it."}\n```').get('goal')).toBe('Fix it.');
  });

  it('falls through to headings when the object holds text for none of the asked ids', () => {
    // Not one JSON object (text follows it), so it is read by heading.
    expect(parse('{"other": "x"}\n## Goal\nFix it.').get('goal')).toBe('Fix it.');
    expect(() => parse('{"other": "x"}')).toThrow(SummaryReplyError);
  });

  it('skips a value that is not text, and keeps the others', () => {
    const written = parse('{"goal": 5, "state": "Done.", "decisions": {"a": "b"}}');

    expect([...written.keys()]).toEqual(['state']);
  });
});

describe('parseSectionReply failures', () => {
  it.each([
    ['prose with no heading', 'Here is the summary: …'],
    ['a JSON array', '["goal"]'],
    ['an object with none of the asked-for sections', '{"other": "x"}'],
    ['only headings that name no section', '## Notes\nx'],
    ['nothing', ''],
  ])('refuses %s with a typed error', (_name, reply) => {
    expect(() => parse(reply)).toThrow(SummaryReplyError);
  });

  it.each([
    ['prose', 'Here is the summary of the chat.', '32 characters, starting with prose'],
    ['a code fence', '```\nnot a summary\n```', '21 characters, starting with a code fence'],
    ['nothing', '', '0 characters, starting with nothing'],
    ['a brace', '{"goal": ', '9 characters, starting with a brace'],
  ])('says what shape an unusable reply had: %s', (_name, reply, shape) => {
    expect(() => parse(reply)).toThrow(shape);
  });

  it('never quotes the reply in the error, which is model-written text', () => {
    let failure: unknown;

    try {
      parse('sk-secretsecretsecretsecret has no heading');
    } catch (caughtError) {
      failure = caughtError;
    }

    expect(failure).toBeInstanceOf(SummaryReplyError);
    expect(failure instanceof Error && failure.message).not.toContain('secretsecret');
  });
});
