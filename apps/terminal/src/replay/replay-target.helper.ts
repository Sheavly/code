import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { ReplayNotFoundError } from '../errors/replay.errors.js';
import { WorkbookStore } from '../workbook/store.service.js';
import { WORKBOOK_DIR } from '../workbook/workbook.constants.js';
import { FOLDER_PATH } from './replay.constants.js';

/** Whether `folder` is a folder; a path that isn't there is not one. */
async function isFolder(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return false;
    throw caughtError;
  }
}

/**
 * The folder to read. A target with a `/` or a leading dot is a folder path and must be one; a
 * bare word is a workbook run (id, number, unique start of an id, or `last`), so a file or folder
 * of that name in the current directory never stands in for the run. Throws `ReplayNotFoundError`
 * for a folder path that isn't a folder, and the workbook's `WorkbookNotFoundError` for a run
 * that isn't there.
 */
export async function replayFolder(target: string): Promise<string> {
  if (!FOLDER_PATH.test(target)) {
    // Only `resolveRun` and `paths` are used: they read `state.json` and the run folder names.
    // The store also writes, which lint cannot tell apart, so this stays a review point.
    const store = new WorkbookStore(path.resolve(WORKBOOK_DIR));

    return store.paths(await store.resolveRun(target)).dir;
  }

  if (await isFolder(target)) return target;

  throw new ReplayNotFoundError({ wanted: target, message: `${target} is not a folder` });
}
