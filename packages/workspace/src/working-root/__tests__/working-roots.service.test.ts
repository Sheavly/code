import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceError } from '../../errors/workspace.errors.js';
import { brokenGitEnv, git, openWithWorktrees, useTempRepo } from '../../testing/git-repo.fake.js';
import { WorkingRoots } from '../working-roots.service.js';
import { memoryWorkingRootStore, testWorkingRoots } from '../../testing/working-root-store.fake.js';
import type { WorkingRootStore } from '../working-root.types.js';

const repo = useTempRepo({ prefix: 'working-roots-', perTest: true });

/** A conversation's roots over `store`, in a workspace that reaches the repo's worktrees. */
async function rootsOver(store: WorkingRootStore = memoryWorkingRootStore()) {
  return testWorkingRoots({ workspace: await openWithWorktrees(repo.main), store });
}

describe('WorkingRoots', () => {
  it('is unset until a root is chosen', async () => {
    await expect((await rootsOver()).get()).resolves.toBeUndefined();
  });

  it('sets a sibling worktree and reads the real branch from git', async () => {
    const roots = await rootsOver();

    await expect(roots.set(repo.worktree)).resolves.toEqual({
      root: repo.worktree,
      branch: 'feature',
    });
    await expect(roots.get()).resolves.toEqual({ root: repo.worktree, branch: 'feature' });
  });

  it('resolves a relative path against the workspace root', async () => {
    const roots = await rootsOver();

    await expect(roots.set('src')).resolves.toMatchObject({ root: path.join(repo.main, 'src') });
  });

  it('is seen at once by every reader of the same store', async () => {
    const store = memoryWorkingRootStore();
    const mainSession = await rootsOver(store);
    const subAgent = await rootsOver(store);

    await mainSession.set(repo.worktree);

    await expect(subAgent.get()).resolves.toMatchObject({ root: repo.worktree });
  });

  it('keeps the roots of separate conversations apart', async () => {
    const first = await rootsOver();
    const second = await rootsOver();

    await first.set(repo.worktree);

    await expect(second.get()).resolves.toBeUndefined();
  });

  it('refuses a folder that does not exist', async () => {
    const roots = await rootsOver();

    await expect(roots.set(path.join(repo.main, 'nope'))).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('refuses a folder the workspace cannot reach, before git looks at it', async () => {
    const roots = await rootsOver();

    await expect(roots.set(repo.outside)).rejects.toThrow('outside the workspace');
    await expect(roots.get()).resolves.toBeUndefined();
  });

  it('accepts a sub-folder of a checkout, which is inside its work tree', async () => {
    await mkdir(path.join(repo.main, 'plain'));
    await writeFile(path.join(repo.main, 'plain', 'x.txt'), 'x\n');
    const roots = await rootsOver();

    await expect(roots.set('plain')).resolves.toMatchObject({
      root: path.join(repo.main, 'plain'),
    });
  });

  it('refuses a reachable folder that is a bare repo, where rev-parse says false', async () => {
    const bare = path.join(repo.main, 'bare.git');

    await git(repo.main, 'init', '--bare', bare);
    const roots = await rootsOver();

    await expect(roots.set(bare)).rejects.toThrow(/not in a git work tree|not in a git repository/);
    await expect(roots.get()).resolves.toBeUndefined();
  });

  it('never runs a program a hostile repo config names while inspecting it', async () => {
    const marker = path.join(repo.base, 'ran');
    const script = path.join(repo.base, 'hook.sh');

    await writeFile(script, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    await git(repo.worktree, 'config', 'core.fsmonitor', script);
    await git(repo.worktree, 'config', 'core.hooksPath', repo.base);
    const roots = await rootsOver();

    await roots.set(repo.worktree);
    await roots.state();

    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses .git itself, so a search can never start inside it', async () => {
    const roots = await rootsOver();

    await expect(roots.set(path.join(repo.main, '.git'))).rejects.toBeInstanceOf(WorkspaceError);
    await expect(roots.get()).resolves.toBeUndefined();
  });

  it('refuses a folder inside .git', async () => {
    const roots = await rootsOver();

    await expect(roots.set(path.join(repo.main, '.git', 'refs'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('refuses a file as the root', async () => {
    const roots = await rootsOver();

    await expect(roots.set('src/index.ts')).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('clears the root, and keeps any other key of the document', async () => {
    const store = memoryWorkingRootStore({ other: 1 });
    const roots = await rootsOver(store);

    await roots.set(repo.worktree);
    await roots.clear();

    await expect(roots.get()).resolves.toBeUndefined();
    await expect(store.load()).resolves.toEqual({ other: 1 });
  });

  it('keeps the file reads another owner stored in the same document, through set and clear', async () => {
    const reads = { '/w/a.ts': { chunks: ['x'], whole: true, hash: 'h' } };
    const store = memoryWorkingRootStore({ fileReads: reads });
    const roots = await rootsOver(store);

    await roots.set(repo.worktree);
    await expect(store.load()).resolves.toMatchObject({ fileReads: reads });
    // The document now holds a key the working root does not own: reading it must still work.
    await expect(roots.get()).resolves.toMatchObject({ root: repo.worktree });

    await roots.clear();
    await expect(store.load()).resolves.toEqual({ fileReads: reads });
  });

  it('follows the branch when it is switched', async () => {
    const roots = await rootsOver();

    await roots.set(repo.worktree);
    await git(repo.worktree, 'switch', '-c', 'renamed');

    await expect(roots.get()).resolves.toMatchObject({ branch: 'renamed' });
  });
});

describe('a root that is still a folder but stopped being a work tree', () => {
  it('is gone for root, get and state alike, so no tool keeps working in it', async () => {
    const roots = await rootsOver();

    await roots.set(repo.worktree);
    // The folder stays, but its `.git` link is removed: it is no longer a work tree.
    await rm(path.join(repo.worktree, '.git'));

    await expect(roots.root()).rejects.toThrow('can no longer be used');
    await expect(roots.get()).rejects.toThrow('can no longer be used');
    await expect(roots.state()).resolves.toMatchObject({ kind: 'gone', root: repo.worktree });
  });

  it('is gone when the folder was replaced by a bare repo', async () => {
    const roots = await rootsOver();

    await roots.set(repo.worktree);
    await rm(repo.worktree, { recursive: true });
    await git(repo.main, 'init', '--bare', repo.worktree);

    await expect(roots.root()).rejects.toThrow('can no longer be used');
  });
});

describe('WorkingRoots.root, the check every tool call makes', () => {
  it('treats a git that fails as an error to report, not as a root that is gone', async () => {
    const store = memoryWorkingRootStore();

    await (await rootsOver(store)).set(repo.worktree);
    const brokenGit = new WorkingRoots({
      store,
      workspace: await openWithWorktrees(repo.main),
      env: await brokenGitEnv({ repo }),
    });

    // A crash or timeout says nothing about the folder, so it never reads as "gone": the call
    // fails with the git error, and `state` rethrows it as well.
    await expect(brokenGit.root()).rejects.toMatchObject({ name: 'PathCheckError' });
    await expect(brokenGit.state()).rejects.toMatchObject({ name: 'PathCheckError' });
  });

  it('is undefined while none is set', async () => {
    await expect((await rootsOver()).root()).resolves.toBeUndefined();
  });

  it('reports a gone root as get does, so no path starts somewhere else', async () => {
    const roots = await rootsOver();

    await roots.set(repo.worktree);
    await rm(repo.worktree, { recursive: true });

    await expect(roots.root()).rejects.toThrow('can no longer be used');
  });
});

describe('WorkingRoots when the stored root can no longer be used', () => {
  it('reports it as gone and refuses to answer, so no path quietly starts elsewhere', async () => {
    const roots = await rootsOver();

    await roots.set(repo.worktree);
    await git(repo.main, 'worktree', 'remove', '--force', repo.worktree);

    await expect(roots.state()).resolves.toMatchObject({ kind: 'gone', root: repo.worktree });
    await expect(roots.get()).rejects.toThrow('can no longer be used');
    await expect(roots.get()).rejects.toThrow('set_working_root');
  });

  it('recovers when the agent sets another root or clears it', async () => {
    const roots = await rootsOver();

    await roots.set(repo.worktree);
    await rm(repo.worktree, { recursive: true });
    await roots.set(repo.main);

    await expect(roots.get()).resolves.toMatchObject({ root: repo.main });

    await rm(path.join(repo.main, 'src'), { recursive: true });
    await roots.set(repo.main);
    await roots.clear();

    await expect(roots.state()).resolves.toEqual({ kind: 'unset' });
  });

  it('treats a root that is no longer reachable as gone', async () => {
    const store = memoryWorkingRootStore({ workingRoot: repo.outside });
    const roots = await rootsOver(store);

    await expect(roots.state()).resolves.toMatchObject({ kind: 'gone', root: repo.outside });
  });
});

describe('WorkingRoots over a shell.json that is not valid', () => {
  it.each([{ workingRoot: 7 }, { workingRoot: 'relative/path' }, { workingRoot: '' }])(
    'rejects %j with a message, never reading it as unset',
    async (document) => {
      const roots = await rootsOver(memoryWorkingRootStore(document));

      await expect(roots.get()).rejects.toBeInstanceOf(WorkspaceError);
    },
  );
});
