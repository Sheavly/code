import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempRepo, removeTempRepos } from '../../../scripts/__tests__/temp-repo.utils.mjs';
import { readmeNote, workspaceOf } from '../workspace-readme.utils.mjs';
import { runEditHook } from './run-hook.utils.mjs';

let project = '';
let stateDir = '';

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'hook-state-'));
  project = createTempRepo({
    'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['packages/*', 'apps/*'] }),
    'packages/core/package.json': JSON.stringify({ name: '@sheavly/core' }),
    'packages/core/README.md': '# @sheavly/core\n\nCORE README\n',
    'packages/core/src/tool/tool.md': '',
    'packages/core/docs/tools.md': '',
    'packages/loop/package.json': JSON.stringify({ name: '@sheavly/loop' }),
    'packages/loop/README.md': '# @sheavly/loop\n\nLOOP README\n',
    'packages/loop/src/x/x.md': '',
    'docs/x.md': '',
  });
});

afterEach(() => {
  removeTempRepos();
  rmSync(stateDir, { recursive: true, force: true });
});

const edited = (file, chat = 'c1') =>
  runEditHook({ cwd: project, file: path.join(project, file), chat, stateDir })
    .additional_context ?? '';

describe('the workspace README on touch', () => {
  it('finds the workspace a file is in, and none for a file outside every workspace', () => {
    expect(workspaceOf({ root: project, relative: 'packages/core/src/tool/x.ts' })).toMatchObject({
      name: '@sheavly/core',
      relative: 'packages/core',
    });
    expect(workspaceOf({ root: project, relative: 'docs/x.md' })).toBeUndefined();
  });

  it('shows the whole README, and names the router for the other workspaces', () => {
    const note = readmeNote({
      root: project,
      workspace: { name: '@sheavly/core', relative: 'packages/core' },
    });

    expect(note).toContain('CORE README');
    expect(note).toContain('sheavly-packages');
  });

  it('shows each workspace once per chat, on its first edit there, docs included', () => {
    expect(edited('packages/core/docs/tools.md')).toContain('CORE README');
    expect(edited('packages/core/src/tool/tool.md')).not.toContain('CORE README');
    expect(edited('packages/loop/src/x/x.md')).toContain('LOOP README');
    expect(edited('packages/core/src/tool/tool.md', 'c2')).toContain('CORE README');
    expect(edited('docs/x.md', 'c3')).not.toContain('README');
  });
});
