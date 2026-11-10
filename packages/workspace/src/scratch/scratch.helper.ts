import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { now } from '@sheavly/core/clock/clock.helper';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { ScratchPruneError } from '../errors/scratch.errors.js';
import { SCRATCH_MAX_AGE_MS } from './scratch.constants.js';
import { assertPrivateDirectory } from './scratch-root.helper.js';

/**
 * Removes the top-level entries of the scratch `root` whose newest modification is older than
 * `maxAgeMs` (default 14 days). An agent folder counts as one entry: it goes only once everything
 * in it is stale. Symlinks are never followed (a link is judged and removed as itself), the root
 * is never deleted, and a missing root is fine. A root that is a symlink, belongs to another user
 * or is group/world-writable is refused with a `WorkspaceError`. Pruning runs at startup only, so
 * a folder written to between the age check and its removal can be lost. Returns the removed
 * paths; if any removal fails the rest are still tried, then it throws `ScratchPruneError`.
 */
export async function pruneScratch(params: { root: string; maxAgeMs?: number }): Promise<string[]> {
  const { root, maxAgeMs = SCRATCH_MAX_AGE_MS } = params;

  if (!(await rootExists(root))) return [];
  const cutoff = now() - maxAgeMs;
  const removed: string[] = [];
  const failures: { path: string; cause: unknown }[] = [];

  for (const entry of await entriesOf(root)) {
    const target = path.join(root, entry);

    try {
      const newest = await newestModification(target);

      if (newest === undefined || newest >= cutoff) continue;
      await rm(target, { recursive: true, force: true });
      removed.push(target);
    } catch (caughtError) {
      failures.push({ path: target, cause: caughtError });
    }
  }

  if (failures.length > 0) throw new ScratchPruneError(failures);

  return removed;
}

/** False for a missing root; any other root must pass the ownership check, or it is not pruned. */
async function rootExists(root: string): Promise<boolean> {
  try {
    await assertPrivateDirectory({ directory: root, label: 'Scratch root' });
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return false;
    throw caughtError;
  }

  return true;
}

async function entriesOf(root: string): Promise<string[]> {
  try {
    return await readdir(root);
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return [];
    throw caughtError;
  }
}

/**
 * The latest mtime in a tree, by `lstat`, so a symlink is never entered. Undefined when the
 * entry is gone (another backend pruned it meanwhile), so there is nothing to remove.
 */
async function newestModification(target: string): Promise<number | undefined> {
  try {
    const stats = await lstat(target);
    let newest = stats.mtimeMs;

    if (!stats.isDirectory()) return newest;

    for (const child of await readdir(target)) {
      const childNewest = await newestModification(path.join(target, child));

      newest = Math.max(newest, childNewest ?? newest);
    }

    return newest;
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return undefined;
    throw caughtError;
  }
}
