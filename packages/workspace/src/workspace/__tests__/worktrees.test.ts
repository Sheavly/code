import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceError } from '../../errors/workspace.errors.js';
import { git, openWithWorktrees, useTempRepo } from '../../testing/git-repo.fake.js';

const repo = useTempRepo({ prefix: 'worktrees-test-', perTest: true });

describe('Workspace in a repo with worktrees', () => {
  it('lets files in a sibling worktree be read and written', async () => {
    const { worktree, main } = repo;
    const workspace = await openWithWorktrees(main);

    await expect(workspace.resolveRead(path.join(worktree, 'src/index.ts'))).resolves.toBe(
      path.join(worktree, 'src/index.ts'),
    );
    await expect(workspace.resolveWrite(path.join(worktree, 'src/new/file.ts'))).resolves.toBe(
      path.join(worktree, 'src/new/file.ts'),
    );
  });

  it('still rejects a path outside every worktree', async () => {
    const { outside, main } = repo;
    const workspace = await openWithWorktrees(main);

    await expect(workspace.resolveRead(path.join(outside, 'secret.txt'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
    await expect(workspace.resolveWrite(path.join(outside, 'new.txt'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('accepts a worktree created after the workspace opened', async () => {
    const { base, main } = repo;
    const workspace = await openWithWorktrees(main);

    await git(main, 'worktree', 'add', '-b', 'late', path.join(base, 'late'));

    await expect(workspace.resolveRead(path.join(base, 'late/src/index.ts'))).resolves.toBe(
      path.join(base, 'late/src/index.ts'),
    );
  });

  it('rejects a worktree path whose symlink or ".." leads outside every worktree', async () => {
    const { base, main, outside, worktree } = repo;

    await symlink(outside, path.join(worktree, 'link-to-outside'));
    const workspace = await openWithWorktrees(main);

    await expect(
      workspace.resolveRead(path.join(worktree, 'link-to-outside/secret.txt')),
    ).rejects.toBeInstanceOf(WorkspaceError);
    await expect(
      workspace.resolveRead(path.join(base, 'wt/../outside/secret.txt')),
    ).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('forgets a worktree that was removed', async () => {
    const { main, worktree } = repo;
    const workspace = await openWithWorktrees(main);

    await git(main, 'worktree', 'remove', worktree);
    await mkdir(worktree);
    await writeFile(path.join(worktree, 'file.txt'), 'x');

    await expect(workspace.resolveRead(path.join(worktree, 'file.txt'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('maps a workspace in a sub-folder to the same folder of each worktree', async () => {
    const { main, worktree } = repo;
    const workspace = await openWithWorktrees(path.join(main, 'src'));

    await expect(workspace.resolveRead(path.join(worktree, 'src/index.ts'))).resolves.toBe(
      path.join(worktree, 'src/index.ts'),
    );
    await expect(workspace.resolveRead(path.join(worktree, 'README.md'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });
});

describe('Workspace outside a git repo', () => {
  it('keeps its single root', async () => {
    const { base, outside } = repo;
    const plain = path.join(base, 'plain');

    await mkdir(plain);
    await writeFile(path.join(plain, 'a.txt'), 'a');
    const workspace = await openWithWorktrees(plain);

    await expect(workspace.resolveRead('a.txt')).resolves.toBe(path.join(plain, 'a.txt'));
    await expect(workspace.resolveRead(path.join(outside, 'secret.txt'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });
});
