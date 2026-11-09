import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTempRepo,
  removeTempRepos,
  REPO_ROOT,
} from '../../../scripts/__tests__/temp-repo.utils.mjs';
import { runHook } from './run-hook.utils.mjs';

let root;
let stateDir;

beforeEach(() => {
  root = createTempRepo({ 'package.json': '{"type":"module"}' }, { linkNodeModules: false });
  stateDir = createTempRepo({}, { linkNodeModules: false });
  cpSync(path.join(REPO_ROOT, '.cursor/hooks'), path.join(root, '.cursor/hooks'), {
    recursive: true,
    filter: (file) => path.basename(file) !== '__tests__',
  });
  expect(spawnSync('git', ['init', '-q', '-b', '162-bootstrap'], { cwd: root }).status).toBe(0);
});

afterEach(removeTempRepos);

function hook(params) {
  return runHook({
    cwd: root,
    stateDir,
    hooksRoot: path.join(root, '.cursor/hooks'),
    ...params,
    input: { conversation_id: 'bootstrap', workspace_roots: [root], cwd: root, ...params.input },
  });
}

describe('guards before dependency installation', () => {
  it('accepts prompts and the installation command without node_modules', () => {
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false);
    expect(hook({ script: 'require-issue.mjs', input: { prompt: 'continue' } })).toEqual({
      continue: true,
    });

    for (const script of ['guard-shell-commands.mjs', 'guard-git-workflow.mjs']) {
      expect(hook({ script, input: { command: 'npm ci' } })).toEqual({ permission: 'allow' });
    }
  });

  it('still rejects unsafe edits and git operations', () => {
    expect(
      hook({ script: 'guard-shell-commands.mjs', input: { command: 'sed -i s/a/b/ source.ts' } }),
    ).toMatchObject({ permission: 'deny' });
    expect(
      hook({ script: 'guard-git-workflow.mjs', input: { command: 'git push --force' } }),
    ).toMatchObject({ permission: 'deny' });
  });

  it('fails closed with a useful error for corrupt state', () => {
    writeFileSync(path.join(stateDir, 'bootstrap.json'), 'not JSON');
    const response = hook({ script: 'require-issue.mjs', input: { prompt: 'continue' } });

    expect(response.continue).toBe(false);
    expect(response.user_message).toContain('bootstrap.json could not be read');
  });

  it('reports missing formatting dependencies instead of silently crediting a formatter write', () => {
    writeFileSync(path.join(root, 'source.ts'), 'const x=1');
    const response = hook({
      script: 'guard-shell-commands.mjs',
      input: { command: 'npx prettier --write source.ts' },
    });

    expect(response.permission).toBe('deny');
    expect(response.agent_message).toContain("Cannot find package 'prettier'");
  });
});
