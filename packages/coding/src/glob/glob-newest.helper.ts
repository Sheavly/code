import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { GLOB_STAT_BATCH } from './glob.constants.js';

type Dated = { file: string; mtimeMs: number };

/** The file's own modification time (not a symlink target's), or undefined if it just vanished. */
async function modified(params: { root: string; file: string }): Promise<Dated | undefined> {
  const { root, file } = params;

  try {
    return { file, mtimeMs: (await lstat(path.join(root, file))).mtimeMs };
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return undefined;
    throw caughtError;
  }
}

/**
 * Sorts `files` (relative to `root`) by modification time, newest first, ties by path. ripgrep
 * cannot sort by mtime, so each file is stat-ed, a batch at a time. A file deleted since ripgrep
 * listed it is left out. Throws if `signal` aborts.
 */
export async function sortNewestFirst(params: {
  root: string;
  files: string[];
  signal: AbortSignal;
}): Promise<string[]> {
  const { root, files, signal } = params;
  const dated: Dated[] = [];

  for (let start = 0; start < files.length; start += GLOB_STAT_BATCH) {
    signal.throwIfAborted();
    const batch = files.slice(start, start + GLOB_STAT_BATCH);
    const found = await Promise.all(batch.map((file) => modified({ root, file })));

    dated.push(...found.filter((entry) => entry !== undefined));
  }

  return dated
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file, 'en'))
    .map(({ file }) => file);
}
