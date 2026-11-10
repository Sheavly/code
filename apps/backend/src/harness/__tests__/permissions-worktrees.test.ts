import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';
import { PathCheckError } from '@sheavly/workspace/errors/workspace.errors';
import { useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { workspacePermissions } from '../permissions.helper.js';

const repo = useTempRepo({ prefix: 'permissions-worktrees-', perTest: true });

function permissionsIn(workspace: string) {
  const store = new PermissionStore({ root: path.join(repo.base, 'sheavly') });

  return { store, permissions: workspacePermissions({ store, workspace, env: process.env }) };
}

describe('workspacePermissions in a repo with worktrees', () => {
  it('lets a worktree use what was allowed in the main checkout, mode included', async () => {
    const { store } = permissionsIn(repo.main);
    const main = workspacePermissions({ store, workspace: repo.main, env: process.env });
    const linked = workspacePermissions({ store, workspace: repo.worktree, env: process.env });

    await main.allow('git log *');
    await store.setMode({ realPath: repo.main, mode: 'allow_all' });

    expect(await linked.read()).toEqual({ mode: 'allow_all', allow: ['git log *'] });
  });

  it('keeps what a worktree allows for the main checkout and its other worktrees', async () => {
    const { store, permissions: linked } = permissionsIn(repo.worktree);
    const main = workspacePermissions({ store, workspace: repo.main, env: process.env });

    await linked.allow('npm run test *');

    expect(await main.read()).toMatchObject({ allow: ['npm run test *'] });
    expect(await store.read(repo.main)).toMatchObject({ allow: ['npm run test *'] });
  });

  it('leaves an unrelated folder with its own permissions', async () => {
    const { permissions: linked } = permissionsIn(repo.worktree);
    const { permissions: unrelated } = permissionsIn(repo.outside);

    await linked.allow('ls *');

    expect(await unrelated.read()).toEqual({ mode: 'ask', allow: [] });
  });

  it('asks about every command, allowing none, when git cannot be checked', async () => {
    const { store } = permissionsIn(repo.main);
    const bin = path.join(repo.base, 'bin');

    await store.allow({ realPath: repo.worktree, entry: 'rm *' });
    await store.setMode({ realPath: repo.worktree, mode: 'allow_all' });
    await mkdir(bin);
    await writeFile(path.join(bin, 'git'), '#!/bin/sh\nexit 1\n');
    await chmod(path.join(bin, 'git'), 0o755);
    const broken = workspacePermissions({ store, workspace: repo.worktree, env: { PATH: bin } });

    await broken.allowSession?.('ls *');

    // The folder's own looser file is not used, and the session grant is not trusted either.
    expect(await broken.read()).toEqual({ mode: 'always_ask', allow: [] });
    await expect(broken.allow('npm test *')).rejects.toBeInstanceOf(PathCheckError);
  });

  it('is the same for a sub-agent, which shares its conversation’s permissions', async () => {
    const { store } = permissionsIn(repo.main);
    const main = workspacePermissions({ store, workspace: repo.main, env: process.env });
    const conversation = workspacePermissions({
      store,
      workspace: repo.worktree,
      env: process.env,
    });

    await main.allow('git status *');

    // The backend hands this one object to the main run_command tool and each sub-agent's.
    const subAgent = conversation;

    expect(await subAgent.read()).toMatchObject({ allow: ['git status *'] });
  });

  it('never lets a forged .git file borrow the repo’s permissions', async () => {
    const forged = path.join(repo.outside, 'forged');
    const { store, permissions: main } = permissionsIn(repo.main);
    const borrowing = workspacePermissions({ store, workspace: forged, env: process.env });

    await mkdir(forged);
    await writeFile(path.join(forged, '.git'), `gitdir: ${path.join(repo.main, '.git')}\n`);
    await main.allow('git push *');

    expect(await borrowing.read()).toEqual({ mode: 'ask', allow: [] });
  });
});
