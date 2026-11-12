// The hook's behaviour: naming a governing skill once per chat. What a skill's metadata may say,
// and how a bad one is reported, is held by the shared reader's tests
// (packages/eslint-config/src/__tests__/skills.test.js).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKILL_METADATA_FILE, SKILLS_DIR } from '../../../packages/eslint-config/src/skills.js';
import { runEditHook } from './run-hook.utils.mjs';

let stateDir = '';
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

  it('shows a narrower guide after the skill was shown, instead of hiding it', () => {
    skill({ governs: ['docs/**'], guides: { 'loop.md': ['docs/loop/**'] } });
    write({ [`${SKILLS_DIR}/zz-skill/loop.md`]: '', 'docs/loop/zz.md': '' });

    const first = runEditHook({ cwd: project, stateDir, file: 'docs/zz.md' });
    const narrower = runEditHook({ cwd: project, stateDir, file: 'docs/loop/zz.md' });
    const again = runEditHook({ cwd: project, stateDir, file: 'docs/loop/zz.md' });

    expect(first.additional_context).toContain('governed by the `zz-skill` skill');
    expect(narrower.additional_context).toContain(`${SKILLS_DIR}/zz-skill/loop.md`);
    expect(narrower.additional_context).not.toContain('governed by the `zz-skill` skill');
    expect(again.additional_context ?? '').not.toContain('zz-skill');
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
