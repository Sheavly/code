import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { WorkspaceError } from '../errors/workspace.errors.js';
import { Workspace } from '../workspace/workspace.service.js';
import type { TempRepo } from './testing.types.js';

const execFileAsync = promisify(execFile);

/** Test-only: runs git in `cwd` with a fixed author, so commits work without a user config. */
export async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args],
    { cwd },
  );
}

async function makeTempRepo(params: {
  prefix: string;
  outsideFiles: Record<string, string>;
}): Promise<TempRepo> {
  const { prefix, outsideFiles } = params;
  const base = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  const main = path.join(base, 'main');
  const outside = path.join(base, 'outside');
  const worktree = path.join(base, 'wt');

  await mkdir(path.join(main, 'src'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(main, 'src/index.ts'), 'export {};\n');

  for (const [file, content] of Object.entries(outsideFiles)) {
    await writeFile(path.join(outside, file), content);
  }

  await git(main, 'init', '--initial-branch=main');
  await git(main, 'add', '.');
  await git(main, 'commit', '-m', 'init');
  await git(main, 'worktree', 'add', '-b', 'feature', worktree);

  return { base, main, outside, worktree };
}

/**
 * A temporary git repo with a worktree for a test file, removed afterwards. Shared by the file's
 * tests, or fresh for each one with `perTest`. `outsideFiles` go in `outside/`, in no worktree;
 * by default that is one `secret.txt`, the file an escape test tries to reach.
 */
export function useTempRepo(params: {
  prefix: string;
  perTest?: boolean;
  outsideFiles?: Record<string, string>;
}): TempRepo {
  const { prefix, perTest = false, outsideFiles = { 'secret.txt': 'secret\n' } } = params;
  let opened: TempRepo | undefined;

  const repo: TempRepo = {
    get base() {
      return openRepo().base;
    },
    get main() {
      return openRepo().main;
    },
    get outside() {
      return openRepo().outside;
    },
    get worktree() {
      return openRepo().worktree;
    },
  };

  function openRepo(): TempRepo {
    if (!opened) throw new Error('useTempRepo is only open while its tests run');

    return opened;
  }

  const setUp = async () => {
    opened = await makeTempRepo({ prefix, outsideFiles });
  };
  const tearDown = async () => {
    if (opened) await rm(opened.base, { recursive: true, force: true });
    opened = undefined;
  };

  // `perTest` gives each test its own repo; otherwise the file's tests share one.
  if (perTest) {
    beforeEach(setUp);
    afterEach(tearDown);
  } else {
    beforeAll(setUp);
    afterAll(tearDown);
  }

  return repo;
}

/** Test-only: opens `root` as an app would, passing the environment so worktrees are found. */
export function openWithWorktrees(root: string): Promise<Workspace> {
  return Workspace.open(root, { env: process.env });
}

/** Test-only: `workspace` resolves the absolute path `file` for reading, as itself. */
export async function expectReachable(params: {
  workspace: Workspace;
  file: string;
}): Promise<void> {
  const { workspace, file } = params;

  await expect(workspace.resolveRead(file)).resolves.toBe(file);
}

/** Test-only: `workspace` refuses `requested` for reading as outside the workspace. */
export async function expectRefused(params: {
  workspace: Workspace;
  requested: string;
}): Promise<void> {
  const { workspace, requested } = params;

  await expect(workspace.resolveRead(requested)).rejects.toBeInstanceOf(WorkspaceError);
}
