import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFiles } from '../../../packages/eslint-config/src/testing/workspace.fake.js';
import { strayEditNote } from '../layout.utils.mjs';
import { runEditHook } from './run-hook.utils.mjs';

let stateDir = '';
let project = '';

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'hook-state-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'hook-project-'));
  writeFiles({
    root: project,
    files: {
      'package.json': { name: '@x/app', workspaces: ['packages/*'] },
      'packages/core/package.json': { name: '@x/core' },
      'src/loop/turn.helper.ts': '',
      'packages/core/src/tool/tool.utils.ts': '',
      'tools/gen.ts': '',
      'notes/plan.md': '',
    },
  });
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('the layout note on an edit', () => {
  it('reports TypeScript outside every workspace src/, saying what to do', () => {
    expect(strayEditNote('tools/gen.ts', project)).toContain('outside every workspace');
    expect(strayEditNote('tools/gen.ts', project)).toContain('NOT_SOURCE');
  });

  it('says nothing for workspace source, non-TypeScript files, or what NOT_SOURCE lists', () => {
    expect(strayEditNote('src/loop/turn.helper.ts', project)).toBeNull();
    expect(strayEditNote('packages/core/src/tool/tool.utils.ts', project)).toBeNull();
    expect(strayEditNote('notes/plan.md', project)).toBeNull();
    expect(strayEditNote('vitest.config.ts', project)).toBeNull();
  });

  it('says nothing outside a workspace repo', () => {
    const bare = mkdtempSync(path.join(os.tmpdir(), 'hook-bare-'));

    expect(strayEditNote('tools/gen.ts', bare)).toBeNull();
    rmSync(bare, { recursive: true, force: true });
  });

  it('reaches the agent from the post-edit hook right away', () => {
    const stray = runEditHook({ cwd: project, stateDir, file: 'tools/gen.ts' });
    const inside = runEditHook({ cwd: project, stateDir, file: 'src/loop/turn.helper.ts' });

    expect(stray.additional_context).toContain('Layout: tools/gen.ts is outside every workspace');
    expect(inside.additional_context ?? '').not.toContain('Layout:');
  });
});
