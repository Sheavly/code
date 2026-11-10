import { describe, expect, it } from 'vitest';
import { brokenGitEnv, useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { PathCheckError } from '@sheavly/workspace/errors/workspace.errors';
import { permissionRoot } from '../permission-root.helper.js';

const repo = useTempRepo({ prefix: 'permission-root-', perTest: true });

describe('permissionRoot', () => {
  it('maps a linked worktree to the main one', async () => {
    await expect(permissionRoot({ workspace: repo.worktree, env: process.env })).resolves.toBe(
      repo.main,
    );
  });

  it('throws rather than guess a folder when git cannot be checked', async () => {
    const env = await brokenGitEnv({ repo });

    await expect(permissionRoot({ workspace: repo.worktree, env })).rejects.toBeInstanceOf(
      PathCheckError,
    );
  });
});
