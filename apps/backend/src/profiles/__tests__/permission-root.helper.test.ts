import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { PathCheckError } from '@sheavly/workspace/errors/workspace.errors';
import { permissionRoot } from '../permission-root.helper.js';

const repo = useTempRepo({ prefix: 'permission-root-', perTest: true });

/** A `git` that fails the way a crash does (exit 1), not the way "not a repository" does (128). */
async function brokenGitEnv(): Promise<{ PATH: string }> {
  const bin = path.join(repo.base, 'bin');

  await mkdir(bin);
  await writeFile(path.join(bin, 'git'), '#!/bin/sh\nexit 1\n');
  await chmod(path.join(bin, 'git'), 0o755);

  return { PATH: bin };
}

describe('permissionRoot', () => {
  it('maps a linked worktree to the main one', async () => {
    await expect(permissionRoot({ workspace: repo.worktree, env: process.env })).resolves.toBe(
      repo.main,
    );
  });

  it('throws rather than guess a folder when git cannot be checked', async () => {
    const env = await brokenGitEnv();

    await expect(permissionRoot({ workspace: repo.worktree, env })).rejects.toBeInstanceOf(
      PathCheckError,
    );
  });
});
