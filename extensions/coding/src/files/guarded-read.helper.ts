import { readFile } from 'node:fs/promises';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { assertNotEnvFile } from './files.utils.js';

/**
 * The real path of `file` inside `folder`, symlinks followed, refusing a `.env` file both by the
 * name asked for and by the real path (a symlink can point at one). Throws the guard's
 * `ToolCallError`, which names the requested file and never its contents; a missing file is ENOENT.
 *
 * `folder` must be a `Workspace` rooted at the folder the file belongs to (a skill's or
 * `.sheavly/`'s own), never the agent's working root: `harness/guard-working-root` is off for this
 * file, so nothing else checks that `file` is not a path the agent chose.
 */
export async function resolveGuardedFile(params: {
  folder: Workspace;
  file: string;
}): Promise<string> {
  const { folder, file } = params;

  assertNotEnvFile({ filePath: file, requested: file, action: 'Reading' });
  const real = await folder.resolveRead(file);

  assertNotEnvFile({ filePath: real, requested: file, action: 'Reading' });

  return real;
}

/**
 * The text of `file` inside the folder `dir`, which is a `Workspace` of its own (a skill's folder,
 * `.sheavly/`): no working root applies, so a relative `file` starts at `dir`. Refuses what
 * `resolveGuardedFile` refuses.
 */
export async function readGuardedFile(params: {
  dir: string;
  file: string;
  signal?: AbortSignal | undefined;
}): Promise<{ path: string; text: string }> {
  const { dir, file, signal } = params;
  const real = await resolveGuardedFile({ folder: await Workspace.open(dir), file });
  const text = await readFile(real, { encoding: 'utf8', ...(signal && { signal }) });

  return { path: real, text };
}
