import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { forgeWorktreeEntry, useTempRepo } from '../../testing/git-repo.fake.js';
import { findMainRoot } from '../worktrees.helper.js';

const repo = useTempRepo({ prefix: 'worktrees-main-root-', perTest: true });

describe('findMainRoot', () => {
  it('maps a linked worktree to the main worktree', async () => {
    await expect(findMainRoot({ root: repo.worktree, env: process.env })).resolves.toBe(repo.main);
  });

  it('maps a sub-folder of a linked worktree to the same sub-folder of the main one', async () => {
    const root = path.join(repo.worktree, 'src');

    await expect(findMainRoot({ root, env: process.env })).resolves.toBe(
      path.join(repo.main, 'src'),
    );
  });

  it('keeps the main worktree as it is', async () => {
    await expect(findMainRoot({ root: repo.main, env: process.env })).resolves.toBe(repo.main);
  });

  it('keeps a folder that is in no git repo', async () => {
    await expect(findMainRoot({ root: repo.outside, env: process.env })).resolves.toBe(
      repo.outside,
    );
  });

  it('keeps a worktree folder that is missing from the main one', async () => {
    const root = path.join(repo.worktree, 'only-here');

    await mkdir(root);

    await expect(findMainRoot({ root, env: process.env })).resolves.toBe(root);
  });

  it('keeps a folder that points at the repo but is not one of its worktrees', async () => {
    const [id] = await readdir(path.join(repo.main, '.git/worktrees'));
    const copy = await folderLinkedTo({ name: 'copy', gitdir: `.git/worktrees/${id ?? ''}` });

    await expect(findMainRoot({ root: copy, env: process.env })).resolves.toBe(copy);
  });

  it('keeps a folder that the main worktree holds as a symlink to another folder', async () => {
    await mkdir(path.join(repo.main, 'other'));
    await mkdir(path.join(repo.worktree, 'linked'));
    await symlink(path.join(repo.main, 'other'), path.join(repo.main, 'linked'));
    const root = path.join(repo.worktree, 'linked');

    await expect(findMainRoot({ root, env: process.env })).resolves.toBe(root);
  });

  it('keeps a worktree whose admin entry was forged to name another folder', async () => {
    await forgeWorktreeEntry({ repo, target: repo.outside });

    await expect(findMainRoot({ root: repo.worktree, env: process.env })).resolves.toBe(
      repo.worktree,
    );
  });

  it('keeps a folder whose .git names another repo', async () => {
    const other = await folderLinkedTo({ name: 'other', gitdir: '../elsewhere' });

    await expect(findMainRoot({ root: other, env: process.env })).resolves.toBe(other);
  });
});

/** A folder in `outside/` whose `.git` file names `gitdir`, resolved from the main or outside. */
async function folderLinkedTo(params: { name: string; gitdir: string }): Promise<string> {
  const folder = path.join(repo.outside, params.name);
  const target = params.gitdir.startsWith('.git')
    ? path.join(repo.main, params.gitdir)
    : path.resolve(folder, params.gitdir);

  await mkdir(folder);
  await writeFile(path.join(folder, '.git'), `gitdir: ${target}\n`);

  return folder;
}
