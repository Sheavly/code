import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { WorkspaceError } from '../errors/workspace.errors.js';
import { GROUP_OR_WORLD_WRITE, SCRATCH_MODE } from './scratch.constants.js';

/**
 * Throws unless `directory` is a real directory (never a symlink, which would make its target
 * the scratch space), owned by the current user and not writable by group or others. `mkdir`
 * applies its mode only to what it creates, so a folder someone else made first is refused here.
 * Where the platform has no user ids, only the symlink check applies. The check is by path, so it
 * holds where the parent (`/tmp`) is sticky; it is not re-run on later use.
 */
export async function assertPrivateDirectory(params: {
  directory: string;
  label: string;
}): Promise<void> {
  const { directory, label } = params;
  const stats = await lstat(directory);

  if (!stats.isDirectory()) {
    throw new WorkspaceError(
      `${label} is not a real directory (symlinks are refused): ${directory}`,
    );
  }

  const uid = process.getuid?.();

  // Without user ids (Windows) the mode bits don't describe who can write, so neither is checked.
  if (uid === undefined) return;

  if (stats.uid !== uid) {
    throw new WorkspaceError(
      `${label} belongs to another user: ${directory}. Remove it or choose another scratch root.`,
    );
  }

  if ((stats.mode & GROUP_OR_WORLD_WRITE) !== 0) {
    throw new WorkspaceError(
      `${label} is writable by other users: ${directory}. Run chmod 700 on it or remove it.`,
    );
  }
}

/**
 * Creates the scratch root if needed and returns its path with the parent canonicalized (`/tmp`
 * may be a symlink). The root itself must pass `assertPrivateDirectory`.
 */
export async function openScratchRoot(scratchRoot: string): Promise<string> {
  const absolute = path.resolve(scratchRoot);

  await mkdir(absolute, { recursive: true, mode: SCRATCH_MODE });
  const root = path.join(await realpath(path.dirname(absolute)), path.basename(absolute));

  await assertPrivateDirectory({ directory: root, label: 'Scratch root' });

  return root;
}

/** Creates one agent's folder in the scratch `root` if needed; it must pass the same check. */
export async function openScratchDir(params: {
  root: string;
  agentId: SessionId;
}): Promise<string> {
  const { root, agentId } = params;
  const dir = path.join(root, agentId);

  await mkdir(dir, { recursive: true, mode: SCRATCH_MODE });
  await assertPrivateDirectory({ directory: dir, label: 'Scratch folder' });

  return dir;
}
