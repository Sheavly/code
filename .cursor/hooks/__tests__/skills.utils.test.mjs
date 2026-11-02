import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findGoverningSkills,
  listSkills,
  metadataProblems,
  SKILL_METADATA_FILE,
  SKILLS_DIR,
} from '../skills.utils.mjs';
import { runEditHook } from './run-hook.utils.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
let stateDir = '';

/** The globs of `skill` that match none of `files`, as `name: glob`. */
function staleGlobs(params) {
  const { files, skill: found } = params;
  const matchesAny = (glob) => files.some((file) => path.matchesGlob(file, glob));

  return found.governs.filter((glob) => !matchesAny(glob)).map((glob) => `${found.name}: ${glob}`);
}

let project = '';

function write(files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    writeFileSync(
      path.join(project, file),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
}

/** A skill named like nothing in this repo, with `metadata` (left out when undefined). */
function skill(metadata) {
  const dir = `${SKILLS_DIR}/zz-skill`;

  write({
    [`${dir}/SKILL.md`]: '---\nname: zz-skill\n---\n',
    ...(metadata === undefined ? {} : { [`${dir}/${SKILL_METADATA_FILE}`]: metadata }),
  });
}

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'hook-state-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'hook-project-'));
  write({ 'docs/zz.md': '', 'notes/zz.md': '' });
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('skill metadata', () => {
  it('accepts governs globs, and an empty governs with a manual reason', () => {
    expect(metadataProblems({ governs: ['docs/**'] })).toEqual([]);
    expect(metadataProblems({ governs: [], manual: 'invoked by hand' })).toEqual([]);
  });

  it('rejects an unknown key, a missing governs and an empty one without a reason', () => {
    expect(metadataProblems({ governs: ['a'], govern: ['b'] })).toEqual(['unknown key `govern`']);
    expect(metadataProblems({})).toEqual(['`governs` must be a list of globs']);
    expect(metadataProblems({ governs: [] })).toEqual([
      'an empty `governs` needs a `manual` reason',
    ]);
    expect(metadataProblems({ governs: [], manual: ' ' })).toContain('`manual` must be a reason');
  });

  it('rejects metadata that is not an object, instead of crashing', () => {
    for (const metadata of [null, 'docs/**', 3, ['docs/**']]) {
      expect(metadataProblems(metadata)).toEqual([expect.stringContaining('JSON object')]);
    }
  });

  it('fails on a skill without a harness.json, saying what to add', () => {
    skill(undefined);

    expect(() => listSkills(project)).toThrow(/has no harness\.json/);
  });

  it("reads every one of this repo's skills, and each governs a file or says why not", () => {
    const skills = listSkills(ROOT);

    expect(skills.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['git', 'working-in-sheavly-harness']),
    );
  });

  it("has no glob in this repo's skills that matches no file (a stale one governs nothing)", () => {
    const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout.split('\n');
    const stale = listSkills(ROOT).flatMap((found) => staleGlobs({ files, skill: found }));

    expect(stale).toEqual([]);
  });

  it.each([
    ['packages/protocol/src/event/event.validator.ts', 'working-in-sheavly-harness'],
    ['src/loop/stream-agent/turn.helper.ts', 'working-in-sheavly-harness'],
    ['.github/pull_request_template.md', 'git'],
  ])('names the skill that governs %s', (relative, name) => {
    expect(findGoverningSkills({ root: ROOT, relative }).map((found) => found.name)).toContain(
      name,
    );
  });
});

describe('the post-edit hook', () => {
  it('names the governing skill on the first edit in a chat, then not again', () => {
    skill({ governs: ['docs/**'] });

    const first = runEditHook({ cwd: project, stateDir, file: 'docs/zz.md' });
    const second = runEditHook({ cwd: project, stateDir, file: 'docs/zz.md' });
    const otherChat = runEditHook({ cwd: project, stateDir, file: 'docs/zz.md', chat: 'c2' });

    expect(first.additional_context).toContain('governed by the `zz-skill` skill');
    expect(first.additional_context).toContain(`${SKILLS_DIR}/zz-skill/SKILL.md`);
    expect(second.additional_context ?? '').not.toContain('zz-skill');
    expect(otherChat.additional_context).toContain('zz-skill');
  });

  it('names nothing for a file no skill governs', () => {
    skill({ governs: ['docs/**'] });

    expect(
      runEditHook({ cwd: project, stateDir, file: 'notes/zz.md' }).additional_context ?? '',
    ).not.toContain('zz-skill');
  });

  it('reports a state write that fails in place of the hint, keeping the other notes', () => {
    skill({ governs: ['docs/**'] });
    write({ 'state-file': '' });

    // The state dir is a file, so recording the hint fails with ENOTDIR or EEXIST.
    const response = runEditHook({
      cwd: project,
      stateDir: path.join(project, 'state-file'),
      file: 'docs/zz.md',
    });

    expect(response.additional_context).toMatch(/E(NOTDIR|EXIST)/);
  });

  it('reports null metadata in place of the hint', () => {
    skill(null);

    expect(
      runEditHook({ cwd: project, stateDir, file: 'docs/zz.md' }).additional_context,
    ).toContain('JSON object');
  });

  it('reports broken metadata in place of the hint, without blocking the edit', () => {
    skill({ governs: 'docs/**' });

    expect(
      runEditHook({ cwd: project, stateDir, file: 'docs/zz.md' }).additional_context,
    ).toContain('`governs` must be a list of globs');
  });
});
