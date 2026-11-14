// The one reader of `.agents/skills/*/harness.json`: the Cursor hooks and the lint plugin both
// import it, so what a skill may say and how a bad one is reported is held here.
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findGoverningGuides,
  findGoverningSkills,
  listSkills,
  metadataProblems,
  SKILL_METADATA_FILE,
  SKILLS_DIR,
} from '../skills.js';
import { SkillMetadataError } from '../skills.errors.js';
import { useSkillRepos } from '../testing/skill-repo.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const repoWithSkill = useSkillRepos();

/** The globs of `skill` that match none of `files`, as `name: glob`. */
function staleGlobs(params) {
  const { files, skill } = params;
  const matchesAny = (glob) => files.some((file) => path.posix.matchesGlob(file, glob));

  return skill.governs.filter((glob) => !matchesAny(glob)).map((glob) => `${skill.name}: ${glob}`);
}

describe('skill metadata', () => {
  it('accepts governs globs, and an empty governs with a manual reason', () => {
    expect(metadataProblems({ governs: ['docs/**'] })).toEqual([]);
    expect(metadataProblems({ governs: [], manual: 'invoked by hand' })).toEqual([]);
  });

  it('accepts lintRules and the ruleFiles that point at them', () => {
    expect(
      metadataProblems({
        governs: ['docs/**'],
        lintRules: ['harness/imports'],
        ruleFiles: { 'harness/imports': 'layers.md' },
      }),
    ).toEqual([]);
  });

  it('rejects an unknown key, a missing governs and an empty one without a reason', () => {
    expect(metadataProblems({ governs: ['a'], govern: ['b'] })).toEqual(['unknown key `govern`']);
    expect(metadataProblems({})).toEqual([
      expect.stringContaining('`governs` must be a list of globs'),
    ]);
    expect(metadataProblems({ governs: [] })).toEqual([
      'an empty `governs` needs a `manual` reason',
    ]);
    expect(metadataProblems({ governs: [], manual: ' ' })).toContain('`manual` must be a reason');
  });

  it('rejects lintRules and ruleFiles of the wrong shape', () => {
    expect(metadataProblems({ governs: ['a'], lintRules: 'harness/imports' })).toEqual([
      '`lintRules` must be a list of rule ids',
    ]);
    expect(metadataProblems({ governs: ['a'], ruleFiles: ['layers.md'] })).toEqual([
      '`ruleFiles` must be an object of rule id to file name',
    ]);
    expect(metadataProblems({ governs: ['a'], ruleFiles: { r: 3 } })).toEqual([
      '`ruleFiles` must be an object of rule id to file name',
    ]);
  });

  it('accepts guides as a map of guide file to globs, and rejects other shapes', () => {
    expect(
      metadataProblems({ governs: ['a'], guides: { 'loop.md': ['packages/loop/**'] } }),
    ).toEqual([]);
    const shape = [expect.stringContaining('`guides` must be an object of guide file name')];

    expect(metadataProblems({ governs: ['a'], guides: ['loop.md'] })).toEqual(shape);
    expect(metadataProblems({ governs: ['a'], guides: { 'loop.md': 'packages/loop/**' } })).toEqual(
      shape,
    );
  });

  it('rejects a glob too long or with too many wildcards, which could freeze a hook', () => {
    const hostile = '*a'.repeat(30);
    const long = 'a'.repeat(300);

    expect(metadataProblems({ governs: [hostile] })).toEqual([
      expect.stringContaining('`governs` must be a list of globs'),
    ]);
    expect(metadataProblems({ governs: [long] })).toEqual([
      expect.stringContaining('`governs` must be a list of globs'),
    ]);
    expect(metadataProblems({ governs: ['a'], guides: { 'x.md': [hostile] } })).toEqual([
      expect.stringContaining('`guides` must be an object'),
    ]);
    expect(
      metadataProblems({ governs: ['packages/*/src/**', '{apps,packages}/*/src/**'] }),
    ).toEqual([]);
  });

  it('refuses five wildcard groups separated by literals, and accepts four', () => {
    // Matching time grows steeply with the groups (seconds at five on a long path), so the cap,
    // not a timing, is what keeps a hook from freezing; a wall-clock assertion would be flaky.
    expect(metadataProblems({ governs: ['a*a*a*a*a*b'] })).toEqual([
      expect.stringContaining('`governs` must be a list of globs'),
    ]);
    expect(metadataProblems({ governs: ['a*a*a*a*b'] })).toEqual([]);
  });

  it('counts a run of wildcards as one group, so `**` is not penalised', () => {
    expect(metadataProblems({ governs: ['a/**/b/**/c/**/d/**'] })).toEqual([]);
  });

  it('accepts nudge as a list of guide names, and rejects other shapes', () => {
    expect(metadataProblems({ governs: ['a'], nudge: ['loop.md'] })).toEqual([]);
    expect(metadataProblems({ governs: ['a'], nudge: 'loop.md' })).toEqual([
      '`nudge` must be a list of guide file names',
    ]);
  });

  it('rejects metadata that is not an object, instead of crashing', () => {
    for (const metadata of [null, 'docs/**', 3, ['docs/**']]) {
      expect(metadataProblems(metadata)).toEqual([expect.stringContaining('JSON object')]);
    }
  });
});

describe('listSkills', () => {
  it('reads a skill with its defaults for the optional keys', () => {
    const root = repoWithSkill({ metadata: { governs: ['docs/**'] } });

    expect(listSkills(root)).toEqual([
      {
        name: 'zz-skill',
        dir: `${SKILLS_DIR}/zz-skill`,
        skillFile: `${SKILLS_DIR}/zz-skill/SKILL.md`,
        governs: ['docs/**'],
        lintRules: [],
        ruleFiles: {},
        guides: {},
        nudge: [],
      },
    ]);
  });

  it('is empty without a skills folder', () => {
    expect(listSkills(tempWorkspace({ 'README.md': '' }))).toEqual([]);
  });

  it('fails on a skill without a harness.json, saying what to add', () => {
    const root = repoWithSkill({ metadata: undefined });

    expect(() => listSkills(root)).toThrow(SkillMetadataError);
    expect(() => listSkills(root)).toThrow(/has no harness\.json/);
  });

  it('fails on a harness.json that is not JSON, keeping the cause', () => {
    const root = repoWithSkill({ metadata: '{ not json' });

    expect(() => listSkills(root)).toThrow(/not readable JSON/);
    expect(() => listSkills(root)).toThrow(expect.objectContaining({ cause: expect.any(Error) }));
  });

  it('fails on a ruleFiles entry its lintRules does not name', () => {
    const root = repoWithSkill({
      metadata: { governs: ['a'], ruleFiles: { 'harness/imports': 'layers.md' } },
      extra: { [`${SKILLS_DIR}/zz-skill/layers.md`]: '' },
    });

    expect(() => listSkills(root)).toThrow(/names `harness\/imports`, which `lintRules` doesn't/);
  });

  it('fails on a guide that is missing or not beside SKILL.md', () => {
    const base = { governs: ['a'], lintRules: ['harness/imports'] };
    const missing = repoWithSkill({
      metadata: { ...base, ruleFiles: { 'harness/imports': 'layers.md' } },
    });
    const nested = repoWithSkill({
      metadata: { ...base, ruleFiles: { 'harness/imports': 'sub/layers.md' } },
      extra: { [`${SKILLS_DIR}/zz-skill/sub/layers.md`]: '' },
    });

    expect(() => listSkills(missing)).toThrow(/to `layers\.md`, which isn't a guide file/);
    expect(() => listSkills(nested)).toThrow(/to `sub\/layers\.md`, which isn't a guide file/);
  });

  it.each(['..', '.', '../x.md', '/etc/passwd', 'a\\b.md', 'sub', 'x.txt'])(
    'refuses `%s` as a guide name, so metadata cannot point outside the skill folder',
    (name) => {
      const root = repoWithSkill({
        metadata: { governs: ['a'], guides: { [name]: ['packages/**'] } },
      });

      expect(() => listSkills(root)).toThrow(SkillMetadataError);
      expect(() => listSkills(root)).toThrow(/isn't a guide file/);
    },
  );

  it('refuses a guide that is a directory or a symlink', () => {
    const asDirectory = repoWithSkill({
      metadata: { governs: ['a'], guides: { 'dir.md': ['packages/**'] } },
      extra: { [`${SKILLS_DIR}/zz-skill/dir.md/inner.txt`]: '' },
    });
    const asSymlink = repoWithSkill({
      metadata: { governs: ['a'], guides: { 'link.md': ['packages/**'] } },
    });

    symlinkSync('/etc/hostname', path.join(asSymlink, SKILLS_DIR, 'zz-skill', 'link.md'));

    expect(() => listSkills(asDirectory)).toThrow(/`guides` names `dir\.md`/);
    expect(() => listSkills(asSymlink)).toThrow(/`guides` names `link\.md`/);
  });

  it('fails on a guide that is missing or not beside SKILL.md', () => {
    const missing = repoWithSkill({
      metadata: { governs: ['a'], guides: { 'loop.md': ['packages/loop/**'] } },
    });
    const nested = repoWithSkill({
      metadata: { governs: ['a'], guides: { 'sub/loop.md': ['packages/loop/**'] } },
      extra: { [`${SKILLS_DIR}/zz-skill/sub/loop.md`]: '' },
    });

    expect(() => listSkills(missing)).toThrow(
      /`guides` names `loop\.md`, which isn't a guide file/,
    );
    expect(() => listSkills(nested)).toThrow(/`guides` names `sub\/loop\.md`/);
  });

  it('fails a nudge entry that is not one of the skill’s guides', () => {
    const root = repoWithSkill({
      metadata: { governs: ['a'], guides: { 'loop.md': ['a'] }, nudge: ['gone.md'] },
      extra: { [`${SKILLS_DIR}/zz-skill/loop.md`]: '' },
    });

    expect(() => listSkills(root)).toThrow(/`nudge` names `gone\.md`, which `guides` doesn't/);
  });

  it('picks up a new skill from its own metadata, with no list to edit', () => {
    const root = repoWithSkill({
      metadata: { governs: ['docs/**'] },
      extra: {
        [`${SKILLS_DIR}/zz-other/SKILL.md`]: '',
        [`${SKILLS_DIR}/zz-other/${SKILL_METADATA_FILE}`]: { governs: [], manual: 'by hand' },
      },
    });

    expect(
      listSkills(root)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(['zz-other', 'zz-skill']);
    expect(findGoverningSkills({ root, relative: 'docs/a.md' }).map(({ name }) => name)).toEqual([
      'zz-skill',
    ]);
  });
});

describe('findGoverningGuides', () => {
  // Built per test: the shared afterEach removes every repo a test made.
  const guideRepo = () =>
    repoWithSkill({
      metadata: { governs: ['packages/**'], guides: { 'loop.md': ['packages/loop/**'] } },
      extra: { [`${SKILLS_DIR}/zz-skill/loop.md`]: '' },
    });

  it('names the skill and, as its own entry, the guide covering the file', () => {
    const root = guideRepo();
    const entries = findGoverningGuides({ root, relative: 'packages/loop/src/a.ts' });

    expect(entries.map(({ skill, guide }) => [skill.name, guide])).toEqual([
      ['zz-skill', undefined],
      ['zz-skill', 'loop.md'],
    ]);
  });

  it('names only the skill when no guide covers the file', () => {
    const entries = findGoverningGuides({ root: guideRepo(), relative: 'packages/core/src/a.ts' });

    expect(entries.map(({ guide }) => guide)).toEqual([undefined]);
  });

  it('names nothing for a file no skill governs', () => {
    expect(findGoverningGuides({ root: guideRepo(), relative: 'docs/a.md' })).toEqual([]);
  });
});

describe("this repo's skills", () => {
  it('reads every one, and each governs a file or says why not', () => {
    expect(listSkills(ROOT).map(({ name }) => name)).toEqual(
      expect.arrayContaining(['git', 'sheavly']),
    );
  });

  it('has no glob that matches no file (a stale one governs nothing)', () => {
    const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout.split('\n');
    const stale = listSkills(ROOT).flatMap((skill) => staleGlobs({ files, skill }));

    expect(stale).toEqual([]);
  });

  it.each([
    ['packages/protocol/src/event/event.validator.ts', 'sheavly'],
    ['apps/terminal/src/workbook/run.helper.ts', 'sheavly'],
    ['.github/pull_request_template.md', 'git'],
    ['docs/agent-prompts/research.md', 'adding-models'],
  ])('names the skill that governs %s', (relative, name) => {
    expect(findGoverningSkills({ root: ROOT, relative }).map((found) => found.name)).toContain(
      name,
    );
  });
});
