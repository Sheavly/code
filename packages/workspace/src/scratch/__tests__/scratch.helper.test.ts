import { chmod, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { now } from '@sheavly/core/clock/clock.helper';
import { ScratchPruneError } from '../../errors/scratch.errors.js';
import { WorkspaceError } from '../../errors/workspace.errors.js';
import { SCRATCH_MAX_AGE_MS } from '../scratch.constants.js';
import { pruneScratch } from '../scratch.helper.js';

let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'scratch-prune-test-'));
  root = path.join(base, 'scratch');
  await mkdir(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function agentFile(params: { agent: string; ageMs: number }): Promise<string> {
  const dir = path.join(root, params.agent);
  const file = path.join(dir, 'f.txt');
  const when = (now() - params.ageMs) / 1000;

  await mkdir(dir, { recursive: true });
  await writeFile(file, 'x');
  await utimes(file, when, when);
  await utimes(dir, when, when);

  return dir;
}

const exists = async (target: string) =>
  (await readdir(path.dirname(target))).includes(path.basename(target));

describe('pruneScratch', () => {
  it('removes folders older than 14 days and keeps newer ones', async () => {
    const old = await agentFile({ agent: 'old', ageMs: SCRATCH_MAX_AGE_MS + 1000 });
    const fresh = await agentFile({ agent: 'fresh', ageMs: 1000 });

    expect(await pruneScratch({ root })).toEqual([old]);
    expect(await exists(old)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(await exists(root)).toBe(true);
  });

  it('keeps a folder that still holds a recent file', async () => {
    const dir = await agentFile({ agent: 'mixed', ageMs: SCRATCH_MAX_AGE_MS + 1000 });

    await writeFile(path.join(dir, 'recent.txt'), 'x');
    await pruneScratch({ root });
    expect(await exists(dir)).toBe(true);
  });

  it('does not follow symlinks out of the root', async () => {
    const outside = path.join(base, 'outside');
    const when = (now() - SCRATCH_MAX_AGE_MS - 1000) / 1000;

    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'x');
    await symlink(outside, path.join(root, 'link'));
    await utimes(path.join(root, 'link'), when, when);
    await pruneScratch({ root, maxAgeMs: -1 });
    expect(await exists(path.join(outside, 'keep.txt'))).toBe(true);
    expect(await exists(path.join(root, 'link'))).toBe(false);
  });

  it('refuses a root that is a symlink and deletes nothing in its target', async () => {
    const target = path.join(base, 'target');
    const when = (now() - SCRATCH_MAX_AGE_MS - 1000) / 1000;

    await mkdir(target);
    await writeFile(path.join(target, 'keep.txt'), 'x');
    await utimes(path.join(target, 'keep.txt'), when, when);
    await symlink(target, path.join(base, 'root-link'));
    await expect(pruneScratch({ root: path.join(base, 'root-link') })).rejects.toThrow(
      WorkspaceError,
    );
    expect(await exists(path.join(target, 'keep.txt'))).toBe(true);
  });

  it('refuses a root that another user owns', async () => {
    const other = vi.spyOn(process, 'getuid').mockReturnValue((process.getuid?.() ?? 0) + 1);

    try {
      await expect(pruneScratch({ root })).rejects.toThrow(/belongs to another user/);
    } finally {
      other.mockRestore();
    }
  });

  it('refuses a root that others can write to', async () => {
    await chmod(root, 0o777);
    await expect(pruneScratch({ root })).rejects.toThrow(WorkspaceError);
  });

  it('says how many entries it could not remove', () => {
    const failure = { path: '/s/a', cause: new Error('x') };

    expect(new ScratchPruneError([failure]).message).toBe(
      'Could not remove a stale scratch entry: /s/a',
    );
    expect(new ScratchPruneError([failure, { ...failure, path: '/s/b' }]).message).toBe(
      'Could not remove 2 stale scratch entries: /s/a, /s/b',
    );
  });

  it('treats a missing root as empty', async () => {
    expect(await pruneScratch({ root: path.join(base, 'nope') })).toEqual([]);
  });

  // root ignores file modes, so the folder is never "stuck" there (CI containers)
  it.skipIf(process.getuid?.() === 0)(
    'reports a deletion error and still removes the others',
    async () => {
      await agentFile({ agent: 'a-stuck', ageMs: SCRATCH_MAX_AGE_MS + 1000 });
      const other = await agentFile({ agent: 'b-old', ageMs: SCRATCH_MAX_AGE_MS + 1000 });

      await chmod(path.join(root, 'a-stuck'), 0o500);
      await expect(pruneScratch({ root })).rejects.toThrow(ScratchPruneError);
      expect(await exists(other)).toBe(false);
      await chmod(path.join(root, 'a-stuck'), 0o700);
    },
  );
});
