import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Workspace } from '../workspace.service.js';
import { PathCheckError, WorkspaceError } from '../../errors/workspace.errors.js';

/**
 * Layout (all inside a temp dir):
 *   base/
 *     workspace/
 *       src/index.ts
 *       link-to-inside.ts   -> workspace/src/index.ts
 *       link-to-secret.txt  -> base/outside/secret.txt
 *       link-to-outside/    -> base/outside/
 *       broken-link         -> base/outside/does-not-exist.txt
 *     outside/
 *       secret.txt
 */
let base: string;
let root: string;
let outside: string;
let workspace: Workspace;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'workspace-test-'));
  root = path.join(base, 'workspace');
  outside = path.join(base, 'outside');

  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(root, 'src', 'index.ts'), 'inside\n');
  await writeFile(path.join(outside, 'secret.txt'), 'secret\n');

  await symlink(path.join(root, 'src', 'index.ts'), path.join(root, 'link-to-inside.ts'));
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link-to-secret.txt'));
  await symlink(outside, path.join(root, 'link-to-outside'));
  await symlink(path.join(outside, 'does-not-exist.txt'), path.join(root, 'broken-link'));

  workspace = await Workspace.open(root);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const OUTSIDE = /Path is outside the workspace/;

describe('Workspace.open', () => {
  it('defaults to the current working directory', async () => {
    expect((await Workspace.open()).root).toBe(
      await Workspace.open(process.cwd()).then((w) => w.root),
    );
  });

  it('rejects a root that is not a directory', async () => {
    await expect(Workspace.open(path.join(root, 'src', 'index.ts'))).rejects.toThrow(
      WorkspaceError,
    );
  });
});

describe('resolveRead', () => {
  it('allows files inside the workspace', async () => {
    expect(await workspace.resolveRead('src/index.ts')).toBe(
      path.join(workspace.root, 'src', 'index.ts'),
    );
    expect(await workspace.resolveRead('./src/../src/index.ts')).toBe(
      path.join(workspace.root, 'src', 'index.ts'),
    );
  });

  it('allows symlinks that stay inside the workspace', async () => {
    expect(await workspace.resolveRead('link-to-inside.ts')).toBe(
      path.join(workspace.root, 'src', 'index.ts'),
    );
  });

  it.each(['../outside/secret.txt', 'src/../../outside/secret.txt', '/etc/passwd'])(
    'rejects %s with a clear error',
    async (requested) => {
      await expect(workspace.resolveRead(requested)).rejects.toThrow(OUTSIDE);
      await expect(workspace.resolveRead(requested)).rejects.toThrow(requested);
    },
  );

  it('blocks a symlinked file that points outside', async () => {
    await expect(workspace.resolveRead('link-to-secret.txt')).rejects.toThrow(OUTSIDE);
  });

  it('blocks a symlinked directory that points outside', async () => {
    await expect(workspace.resolveRead('link-to-outside/secret.txt')).rejects.toThrow(OUTSIDE);
  });
});

describe('resolveWrite', () => {
  it('allows new files inside the workspace, including in new directories', async () => {
    expect(await workspace.resolveWrite('src/new.ts')).toBe(
      path.join(workspace.root, 'src', 'new.ts'),
    );
    expect(await workspace.resolveWrite('a/b/c.ts')).toBe(
      path.join(workspace.root, 'a', 'b', 'c.ts'),
    );
  });

  it('allows overwriting existing files inside the workspace', async () => {
    expect(await workspace.resolveWrite('src/index.ts')).toBe(
      path.join(workspace.root, 'src', 'index.ts'),
    );
  });

  it.each([
    '../outside/new.txt',
    '../escape.txt',
    'src/../../outside/secret.txt',
    '/tmp/escape.txt',
  ])('blocks writing %s outside the workspace', async (requested) => {
    await expect(workspace.resolveWrite(requested)).rejects.toThrow(OUTSIDE);
  });

  it('blocks writing through a symlinked file that points outside', async () => {
    await expect(workspace.resolveWrite('link-to-secret.txt')).rejects.toThrow(OUTSIDE);
  });

  it('blocks writing a new file inside a symlinked directory that points outside', async () => {
    await expect(workspace.resolveWrite('link-to-outside/new.txt')).rejects.toThrow(OUTSIDE);
    await expect(workspace.resolveWrite('link-to-outside/deep/new.txt')).rejects.toThrow(OUTSIDE);
  });

  it('blocks writing through a broken symlink (it would create the target outside)', async () => {
    await expect(workspace.resolveWrite('broken-link')).rejects.toThrow('broken symlink');
  });

  it('fails with a PathCheckError, never "missing", when a path cannot be checked', async () => {
    const loop = path.join(root, 'loop');

    await symlink('loop', loop);

    try {
      await expect(workspace.resolveWrite('loop')).rejects.toMatchObject({
        name: 'PathCheckError',
        code: 'ELOOP',
        path: 'loop',
      });
      await expect(workspace.resolveRead('loop')).rejects.toBeInstanceOf(PathCheckError);
      await expect(workspace.resolveRead('src/nope.ts')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(loop);
    }
  });
});
