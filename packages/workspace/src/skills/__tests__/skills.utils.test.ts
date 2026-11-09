import { describe, expect, it } from 'vitest';
import type { Skill } from '../skills.types.js';
import {
  completeSkillMention,
  findSkillMentions,
  formatSkillRequest,
  partsOf,
  skillNamesOf,
  textOf,
  formatSkillsInstructions,
  parseFrontmatter,
  skillBody,
} from '../skills.utils.js';

const skill = (name: string, extra: Partial<Skill> = {}): Skill => ({
  name,
  description: `What ${name} is for.`,
  manualOnly: false,
  dir: `/skills/${name}`,
  scope: 'project',
  ...extra,
});

describe('parseFrontmatter', () => {
  it('reads flat key: value lines, with booleans and quotes', () => {
    expect(
      parseFrontmatter(
        '---\nname: git\ndescription: "Runs git: commits and PRs."\n# a comment\n' +
          'disable-model-invocation: true\n---\nbody',
      ),
    ).toEqual({
      name: 'git',
      description: 'Runs git: commits and PRs.',
      'disable-model-invocation': true,
    });
  });

  it('reads the YAML skills use under a key: folded and literal text, and lists', () => {
    const fields = parseFrontmatter(
      [
        '---',
        'name: autopilot',
        'description: >-',
        '  Keep a PR merge-ready by triaging comments,',
        '  and fixing CI in a loop.',
        'notes: |',
        '  line one',
        '  line two',
        'environments:',
        '  - local',
        '  - "cloud"',
        'paths:',
        '- src/**',
        'long: starts here',
        '  and goes on',
        'metadata:',
        '  author: me',
        '---',
      ].join('\n'),
    );

    expect(fields).toEqual({
      name: 'autopilot',
      description: 'Keep a PR merge-ready by triaging comments, and fixing CI in a loop.',
      notes: 'line one\nline two',
      environments: ['local', 'cloud'],
      paths: ['src/**'],
      long: 'starts here and goes on',
      metadata: 'author: me',
    });
  });

  it('says why a header is unreadable, and undefined when there is none', () => {
    expect(parseFrontmatter('# Just markdown')).toBeUndefined();
    expect(parseFrontmatter('---\nname: x\n')).toBe('the frontmatter has no closing ---');
    expect(parseFrontmatter('---\nname: x\nnot a field\n---')).toBe(
      'the frontmatter line "not a field" is not key: value',
    );
  });

  it('skips a byte order mark and Windows line ends', () => {
    expect(parseFrontmatter('\uFEFF---\r\nname: x\r\n---\r\n')).toEqual({ name: 'x' });
  });
});

describe('skillBody', () => {
  it('is what follows the frontmatter, trimmed', () => {
    expect(skillBody('---\nname: x\n---\n\n# Steps\n\nDo it.\n')).toBe('# Steps\n\nDo it.');
  });
});

describe('formatSkillsInstructions', () => {
  it('lists each skill the model may use, leaving out manual-only ones', () => {
    const text =
      formatSkillsInstructions({
        skills: [skill('review'), skill('git', { manualOnly: true })],
      }) ?? '';

    expect(text).toContain('read_skill');
    expect(text).toContain('\n- review: What review is for.');
    expect(text).not.toContain('git');
  });

  it('says nothing when no skill is offered', () => {
    expect(formatSkillsInstructions({ skills: [] })).toBeUndefined();
    expect(
      formatSkillsInstructions({ skills: [skill('git', { manualOnly: true })] }),
    ).toBeUndefined();
  });

  it('lists every eligible skill beyond 8,000 characters, in order', () => {
    const skills = Array.from({ length: 30 }, (_, index) =>
      skill(`skill-${String(index)}`, { description: 'Detailed guidance. '.repeat(20) }),
    );
    const text = formatSkillsInstructions({ skills }) ?? '';

    expect(text.length).toBeGreaterThan(8000);
    expect(text.split('\n').slice(1)).toEqual(
      skills.map(({ name, description }) => `- ${name}: ${description}`),
    );
    expect(text).not.toContain('more skills not listed');
  });
});

describe('formatSkillRequest', () => {
  it('sends each skill’s instructions, then the user’s text as typed', () => {
    const text = formatSkillRequest({
      skills: [
        { skill: skill('git'), body: 'Do git.' },
        { skill: skill('review'), body: 'Review it.' },
      ],
      text: 'please /review this, then /git submit',
    });

    expect(text).toMatch(/^The user's message below runs these skills \(\/git, \/review\)/);
    expect(text).toContain('## Skill: git\n\nDo git.\n\n## Skill: review\n\nReview it.');
    expect(text.endsWith('---\n\nplease /review this, then /git submit')).toBe(true);
  });
});

const names = (text: string) => findSkillMentions(text).map(({ name }) => name);

describe('findSkillMentions', () => {
  it('finds /<name> at the start, in the middle and at the end, in order', () => {
    expect(names('/git submit')).toEqual(['git']);
    expect(names('please /review this PR')).toEqual(['review']);
    expect(names('fix the tests, then /git.')).toEqual(['git']);
    expect(names('(/review) then /git, then /review again')).toEqual(['review', 'git', 'review']);
    expect(names('use "/create-skill"\non a new line /git')).toEqual(['create-skill', 'git']);
  });

  it('says where each mention is, from its / to the end of its name, for a UI to highlight', () => {
    const text = 'please /review, then /git';

    expect(findSkillMentions(text)).toEqual([
      { name: 'review', start: 7, end: 14 },
      { name: 'git', start: 21, end: 25 },
    ]);
    expect(findSkillMentions(text).map(({ start, end }) => text.slice(start, end))).toEqual([
      '/review',
      '/git',
    ]);
  });

  it('skips paths, URLs and names no skill can have', () => {
    for (const text of [
      'look in /usr/bin',
      'see https://x.dev/git',
      'a/git b',
      '/Git',
      '/a_b',
      '/-x',
      'just /',
      'src/review.ts',
    ]) {
      expect(findSkillMentions(text)).toEqual([]);
    }
  });
});

describe('completeSkillMention', () => {
  const skills = [skill('git'), skill('create-skill'), skill('review'), skill('review-pr')];
  const complete = (text: string, cursor = text.length) =>
    completeSkillMention({ text, cursor, skills });
  const matched = (text: string, cursor?: number) =>
    complete(text, cursor)?.matches.map(({ name }) => name);

  it('offers every skill for a bare /, anywhere in the text', () => {
    expect(matched('/')).toEqual(['create-skill', 'git', 'review', 'review-pr']);
    expect(matched('then run /')).toEqual(['create-skill', 'git', 'review', 'review-pr']);
  });

  it('filters by what was typed: names starting with it first, then names containing it', () => {
    expect(matched('/rev')).toEqual(['review', 'review-pr']);
    expect(matched('/skill')).toEqual(['create-skill']);
    expect(matched('/re')).toEqual(['review', 'review-pr', 'create-skill']);
    expect(matched('/zzz')).toEqual([]);
  });

  it('says what a picked name replaces: from the / to the cursor', () => {
    expect(complete('please /rev this', 11)).toMatchObject({ query: 'rev', start: 7, end: 11 });
  });

  it('offers nothing when the cursor is not right after a /<partial>', () => {
    expect(complete('/git submit')).toBeUndefined();
    expect(complete('look in /usr/b')).toBeUndefined();
    expect(complete('a/gi')).toBeUndefined();
    expect(complete('/git submit', 2)).toMatchObject({ query: 'g' });
  });
});

describe('parts', () => {
  it('turns typed text into parts, known skills as chips and everything else as text', () => {
    expect(
      partsOf({ text: '/git it, then /nope /review.', known: new Set(['git', 'review']) }),
    ).toEqual([
      { type: 'skill', name: 'git' },
      { type: 'text', text: ' it, then /nope ' },
      { type: 'skill', name: 'review' },
      { type: 'text', text: '.' },
    ]);
    expect(partsOf({ text: 'plain', known: new Set() })).toEqual([{ type: 'text', text: 'plain' }]);
  });

  it('reads parts back as text, and lists their skills once each', () => {
    const parts = [
      { type: 'text', text: 'run ' },
      { type: 'skill', name: 'git' },
      { type: 'text', text: ' twice ' },
      { type: 'skill', name: 'git' },
    ] as const;

    expect(textOf(parts)).toBe('run /git twice /git');
    expect(skillNamesOf(parts)).toEqual(['git']);
  });
});
