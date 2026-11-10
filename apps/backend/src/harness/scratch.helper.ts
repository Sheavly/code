import { tmpdir } from 'node:os';
import path from 'node:path';
import { SCRATCH_FOLDER_NAME } from './scratch.constants.js';

/**
 * The one scratch root the backend uses: agents get it, and startup prunes it. It is per OS user,
 * so another user's folder in the shared temp directory never makes this one fail.
 */
export function sharedScratchRoot(): string {
  const uid = process.getuid?.();

  return path.join(
    tmpdir(),
    uid === undefined ? SCRATCH_FOLDER_NAME : `${SCRATCH_FOLDER_NAME}-${uid}`,
  );
}
