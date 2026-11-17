import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import { openWithWorktrees, useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { testWorkingRoots } from '@sheavly/workspace/testing/working-root-store.fake';
import { usableWorkingRoot } from '../usable-working-root.helper.js';

const repo = useTempRepo({ prefix: 'usable-working-root-', perTest: true });

describe('usableWorkingRoot', () => {
  it('gives the folder the working roots name', async () => {
    const workingRoots = testWorkingRoots({ workspace: await openWithWorktrees(repo.main) });

    await workingRoots.set(repo.worktree);

    await expect(usableWorkingRoot(workingRoots).root()).resolves.toBe(repo.worktree);
  });

  it('gives undefined while none is set', async () => {
    const workingRoots = testWorkingRoots({ workspace: await openWithWorktrees(repo.main) });

    await expect(usableWorkingRoot(workingRoots).root()).resolves.toBeUndefined();
  });

  it('gives undefined for a root that went bad, where the working roots themselves throw', async () => {
    const workingRoots = testWorkingRoots({ workspace: await openWithWorktrees(repo.main) });

    await workingRoots.set(repo.worktree);
    await rm(repo.worktree, { recursive: true });

    await expect(workingRoots.root()).rejects.toThrow(WorkspaceError);
    await expect(usableWorkingRoot(workingRoots).root()).resolves.toBeUndefined();
  });

  it('rethrows any other failure', async () => {
    const broken = { root: () => Promise.reject(new Error('disk on fire')) };

    await expect(usableWorkingRoot(broken).root()).rejects.toThrow('disk on fire');
  });
});
