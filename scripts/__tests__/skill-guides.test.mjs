import { afterEach, describe, expect, it } from 'vitest';
import { harnessPlugin } from '../../packages/eslint-config/src/plugin.js';
import { skillGuideProblems } from '../skill-guides.mjs';
import { createTempRepo, REPO_ROOT, removeTempRepos } from './temp-repo.utils.mjs';
import { spawnSync } from 'node:child_process';

afterEach(removeTempRepos);

const ROUTER = '.agents/skills/zz';
const BASE = {
  'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }),
  'packages/loop/package.json': JSON.stringify({ name: '@sheavly/loop' }),
  'packages/loop/src/turn/turn.helper.ts': 'export const turn = 1;\n',
  [`${ROUTER}/SKILL.md`]: '# Router\n\n| loop | [loop.md](loop.md) |\n',
  [`${ROUTER}/loop.md`]: '# Loop\n',
  [`${ROUTER}/harness.json`]: JSON.stringify({
    governs: ['packages/*/src/**'],
    guides: { 'loop.md': ['packages/*/src/**'] },
  }),
};

/** The problems of a repo made from BASE with `files` laid over it. */
function problems(files = {}) {
  const all = { ...BASE, ...files };

  return skillGuideProblems({ root: createTempRepo(all), files: Object.keys(all) });
}

describe('skill guides', () => {
  it('accepts a router whose guides are linked, mapped and cover every workspace', () => {
    expect(problems()).toEqual([]);
  });

  it('is silent when no skill has guides, so a plain skill needs nothing', () => {
    expect(
      problems({ [`${ROUTER}/harness.json`]: JSON.stringify({ governs: ['docs/**'] }) }),
    ).toEqual([]);
  });

  it('fails a guide the hook would never name (no `guides` entry)', () => {
    expect(problems({ [`${ROUTER}/new.md`]: '# New\n' })).toContainEqual(
      expect.stringContaining(`${ROUTER}/new.md: no \`guides\` entry`),
    );
  });

  it('fails a guide the router does not link, even when it is mapped', () => {
    const found = problems({
      [`${ROUTER}/harness.json`]: JSON.stringify({
        governs: ['packages/*/src/**'],
        guides: { 'loop.md': ['packages/*/src/**'], 'new.md': ['packages/*/src/**'] },
      }),
      [`${ROUTER}/new.md`]: '# New\n',
    });

    expect(found).toEqual([expect.stringContaining('SKILL.md does not link it')]);
  });

  it('fails a guides glob that matches no file', () => {
    const found = problems({
      [`${ROUTER}/harness.json`]: JSON.stringify({
        governs: ['packages/*/src/**'],
        guides: { 'loop.md': ['packages/*/src/**', 'gone/**'] },
      }),
    });

    expect(found).toEqual([expect.stringContaining('glob `gone/**` matches no file')]);
  });

  it('fails a guide file the metadata names but the folder does not hold (stale entry)', () => {
    // The shared reader refuses it while reading the skill, so the check never runs on bad metadata.
    expect(() =>
      problems({
        [`${ROUTER}/harness.json`]: JSON.stringify({
          governs: ['packages/*/src/**'],
          guides: { 'loop.md': ['packages/*/src/**'], 'gone.md': ['packages/*/src/**'] },
        }),
      }),
    ).toThrow(/`guides` names `gone\.md`, which isn't a guide file/);
  });

  it('fails a new workspace whose source no guide covers, without editing a list', () => {
    const found = problems({
      [`${ROUTER}/harness.json`]: JSON.stringify({
        governs: ['packages/*/src/**'],
        guides: { 'loop.md': ['packages/loop/**'] },
      }),
      'packages/extra/package.json': JSON.stringify({ name: '@sheavly/extra' }),
      'packages/extra/src/x/x.helper.ts': 'export const x = 1;\n',
    });

    expect(found).toEqual([expect.stringContaining('packages/extra: no guide covers its source')]);
  });

  it('covers a new workspace by a pattern guide, with no change to the metadata', () => {
    expect(
      problems({
        'packages/extra/package.json': JSON.stringify({ name: '@sheavly/extra' }),
        'packages/extra/src/x/x.helper.ts': 'export const x = 1;\n',
      }),
    ).toEqual([]);
  });
});

describe('completeness, read from the code', () => {
  const withRules = (files, ruleNames) => {
    const all = { ...BASE, ...files };

    return skillGuideProblems({ root: createTempRepo(all), files: Object.keys(all), ruleNames });
  };
  const mapped = {
    [`${ROUTER}/harness.json`]: JSON.stringify({
      governs: ['packages/*/src/**'],
      guides: { 'loop.md': ['packages/*/src/**'] },
      lintRules: ['harness/imports'],
      ruleFiles: { 'harness/imports': 'loop.md' },
    }),
  };

  it('accepts a rule a skill maps to a guide', () => {
    expect(withRules(mapped, ['imports'])).toEqual([]);
  });

  it('fails a harness rule no skill maps, saying what to add', () => {
    expect(withRules(mapped, ['imports', 'no-new-thing'])).toEqual([
      expect.stringContaining('harness/no-new-thing: no skill maps this rule to a guide'),
    ]);
  });

  it('skips the rule check when no rule names are given', () => {
    expect(withRules({}, undefined)).toEqual([]);
  });

  it('fails a hook handler no guide names, and passes once a guide does', () => {
    const handlers = {
      'packages/core/src/hook/hook.constants.ts':
        'export const HANDLERS = {\n  sessionStart: true,\n  afterThing: true,\n};\n',
      [`${ROUTER}/loop.md`]: '# Loop\n\nA hook can define `sessionStart`.\n',
    };

    expect(withRules(handlers, [])).toEqual([expect.stringContaining('hook handler `afterThing`')]);
    expect(
      withRules({ ...handlers, [`${ROUTER}/loop.md`]: '`sessionStart` and `afterThing`\n' }, []),
    ).toEqual([]);
  });

  it('does not count a bare mention of a handler, only a backticked one', () => {
    const handlers = {
      'packages/core/src/hook/hook.constants.ts':
        'export const HANDLERS = {\n  afterThing: true,\n};\n',
      [`${ROUTER}/loop.md`]: '# Loop\n\nthe afterThing handler\n',
    };

    expect(withRules(handlers, [])).toEqual([expect.stringContaining('hook handler `afterThing`')]);
  });

  it('fails when the HANDLERS object cannot be read, instead of checking nothing', () => {
    const moved = {
      'packages/core/src/hook/hook.constants.ts': 'export const OTHER = { a: 1 };\n',
    };

    expect(withRules(moved, [])).toEqual([
      expect.stringContaining('could not read every entry of the HANDLERS'),
    ]);
  });

  it('does not take a second object in the file for handlers', () => {
    const files = {
      'packages/core/src/hook/hook.constants.ts':
        'export const HANDLERS = {\n  a: true,\n};\nexport const OTHER = {\n  b: true,\n};\n',
      [`${ROUTER}/loop.md`]: '`a`\n',
    };

    expect(withRules(files, [])).toEqual([]);
  });

  it('reads an entry with a trailing comment, even one holding a brace', () => {
    const files = {
      'packages/core/src/hook/hook.constants.ts':
        'export const HANDLERS = {\n  a: true, // runs {once}\n  b: true,\n};\n',
      [`${ROUTER}/loop.md`]: '`a` and `b`\n',
    };

    expect(withRules(files, [])).toEqual([]);
  });

  it('fails a HANDLERS object it only partly reads, instead of checking some of it', () => {
    const nested = {
      'packages/core/src/hook/hook.constants.ts':
        'export const HANDLERS = {\n  a: true,\n  b: { x: 1 },\n};\n',
      [`${ROUTER}/loop.md`]: '`a`\n',
    };

    expect(withRules(nested, [])).toEqual([
      expect.stringContaining('could not read every entry of the HANDLERS'),
    ]);
  });

  it('does not count a parenthesised mention as a link from the router', () => {
    const found = problems({
      [`${ROUTER}/SKILL.md`]: '# Router\n\nsee (loop.md) somewhere\n',
    });

    expect(found).toEqual([expect.stringContaining('SKILL.md does not link it')]);
  });
});

describe("this repo's skill guides", () => {
  it('has none unlinked, unmapped or stale, and every workspace, rule and hook is covered', () => {
    const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .stdout.split('\n')
      .filter(Boolean);

    expect(
      skillGuideProblems({
        root: REPO_ROOT,
        files,
        ruleNames: Object.keys(harnessPlugin.rules),
      }),
    ).toEqual([]);
  });
});
