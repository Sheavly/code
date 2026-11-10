import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceError } from '../../errors/workspace.errors.js';
import { Workspace } from '../workspace.service.js';
import {
  expectReachable,
  expectRefused,
  openWithWorktrees,
  useTempRepo,
} from '../../testing/git-repo.fake.js';

/**
 * `git worktree list` takes its paths from `.git/worktrees/<id>/gitdir`, which a hostile repo can
 * forge. A listed folder must be refused unless it points back at the repo.
 */
const repo = useTempRepo({ prefix: 'worktrees-forged-', perTest: true });

/** Points the one registered worktree's admin entry at `target`, as a hostile repo could. */
async function forgeWorktreeEntry(target: string): Promise<void> {
  const admin = path.join(repo.main, '.git/worktrees');
  const [id] = await readdir(admin);

  await writeFile(path.join(admin, id ?? '', 'gitdir'), `${path.join(target, '.git')}\n`);
}

describe('Workspace with a forged worktree entry', () => {
  it('refuses a folder with no .git that points back at the repo', async () => {
    await forgeWorktreeEntry(repo.outside);
    const workspace = await openWithWorktrees(repo.main);

    await expect(
      workspace.resolveRead(path.join(repo.outside, 'secret.txt')),
    ).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('refuses the parent of the workspace', async () => {
    await forgeWorktreeEntry(repo.base);
    const workspace = await openWithWorktrees(repo.main);

    await expect(workspace.resolveWrite(path.join(repo.base, 'new.txt'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('refuses a folder whose .git names another repo', async () => {
    const other = path.join(repo.outside, 'other');

    await mkdir(other);
    await writeFile(path.join(other, '.git'), `gitdir: ${path.join(repo.outside, 'elsewhere')}\n`);
    await forgeWorktreeEntry(other);
    const workspace = await openWithWorktrees(repo.main);

    await expectRefused({ workspace, requested: path.join(other, '.git') });
  });

  it('keeps the honest worktree reachable when another entry is forged', async () => {
    const workspace = await openWithWorktrees(repo.main);

    await expectReachable({ workspace, file: path.join(repo.worktree, 'src/index.ts') });
  });
});

describe('Workspace without an env', () => {
  it('has no sibling worktrees', async () => {
    const workspace = await Workspace.open(repo.main);

    await expect(
      workspace.resolveRead(path.join(repo.worktree, 'src/index.ts')),
    ).rejects.toBeInstanceOf(WorkspaceError);
  });
});
