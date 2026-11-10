import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceError } from '../../errors/workspace.errors.js';
import {
  expectReachable,
  expectRefused,
  git,
  openWithWorktrees,
  useTempRepo,
} from '../../testing/git-repo.fake.js';

/**
 * The checks behind "a listed folder is a worktree of this repo": what a hostile branch or a
 * forged `.git/worktrees/<id>/gitdir` can and can't make reachable.
 */
const repo = useTempRepo({ prefix: 'worktrees-hardening-', perTest: true });

/** The admin file git keeps for the worktree `repo.worktree` (its id is the folder's name). */
const adminGitdir = () =>
  path.join(repo.main, '.git/worktrees', path.basename(repo.worktree), 'gitdir');

/** A folder in no worktree whose `.git` is `dotGit`, listed by git through a rewritten admin file. */
async function listAsWorktree(params: { folder: string; dotGit: string | { symlinkTo: string } }) {
  const { folder, dotGit } = params;
  const file = path.join(folder, '.git');

  await mkdir(folder);

  if (typeof dotGit === 'string') await writeFile(file, dotGit);
  else await symlink(dotGit.symlinkTo, file);

  await writeFile(adminGitdir(), `${file}\n`);
}

describe('a sibling worktree', () => {
  it('is still found when git records its back-link relative to the admin folder', async () => {
    const relative = path.relative(path.dirname(adminGitdir()), path.join(repo.worktree, '.git'));

    await writeFile(adminGitdir(), `${relative}\n`);
    const workspace = await openWithWorktrees(repo.main);

    await expectReachable({ workspace, file: path.join(repo.worktree, 'src/index.ts') });
  });

  it('is refused when its .git is a symlink to a real worktree .git', async () => {
    const imposter = path.join(repo.outside, 'imposter');

    await listAsWorktree({
      folder: imposter,
      dotGit: { symlinkTo: path.join(repo.worktree, '.git') },
    });
    const workspace = await openWithWorktrees(repo.main);

    await expectRefused({ workspace, requested: path.join(imposter, '.git') });
  });

  it('is refused when the folder names the admin folder but the admin file names another .git', async () => {
    const decoy = path.join(repo.outside, 'decoy');
    const admin = path.dirname(adminGitdir());

    await mkdir(decoy);
    await writeFile(path.join(decoy, '.git'), `gitdir: ${admin}\n`);
    await writeFile(adminGitdir(), `${path.join(repo.outside, 'somewhere/.git')}\n`);
    const workspace = await openWithWorktrees(repo.main);

    await expect(workspace.resolveRead(path.join(decoy, 'x'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('does not let one entry with an impossible name hide the honest worktrees', async () => {
    const second = path.join(repo.base, 'second');

    await git(repo.main, 'worktree', 'add', '-b', 'second', second);
    await writeFile(adminGitdir(), `${path.join(repo.outside, 'n'.repeat(300), '.git')}\n`);
    const workspace = await openWithWorktrees(repo.main);

    await expect(workspace.resolveRead(path.join(second, 'src/index.ts'))).resolves.toBe(
      path.join(second, 'src/index.ts'),
    );
  });
});

describe('a workspace in a sub-folder', () => {
  it('refuses a sibling whose sub-folder is a symlink out of its worktree', async () => {
    await rm(path.join(repo.worktree, 'src'), { recursive: true });
    await symlink(repo.outside, path.join(repo.worktree, 'src'));
    const workspace = await openWithWorktrees(path.join(repo.main, 'src'));

    await expect(
      workspace.resolveRead(path.join(repo.outside, 'secret.txt')),
    ).rejects.toBeInstanceOf(WorkspaceError);
  });
});

describe('the limit of the back-link check', () => {
  it('accepts a folder when both ends were forged: that takes write access inside .git', async () => {
    const forged = path.join(repo.outside, 'forged');
    const admin = path.dirname(adminGitdir());

    await listAsWorktree({ folder: forged, dotGit: `gitdir: ${admin}\n` });
    const workspace = await openWithWorktrees(repo.main);

    await expect(workspace.resolveWrite(path.join(forged, 'new.txt'))).resolves.toBe(
      path.join(forged, 'new.txt'),
    );
  });
});
