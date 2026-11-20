import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { ProjectSettingsError } from '../errors/project-settings.errors.js';
import { resolveGuardedFile } from '../files/guarded-read.helper.js';
import { SHEAVLY_DIR } from '../project-hooks/project-hooks.constants.js';
import { MAX_PROJECT_SETTINGS_BYTES, PROJECT_SETTINGS_FILE } from './project-settings.constants.js';
import type { ProjectSettingsCause, ProjectSettingsRead } from './project-settings.types.js';

/** The path of `<root>/.sheavly/settings.json`, as the reader reports it (`root` made absolute, not resolved through links). */
export function projectSettingsPath(params: { root: string }): string {
  return path.join(path.resolve(params.root), SHEAVLY_DIR, PROJECT_SETTINGS_FILE);
}

/**
 * Whether `<root>/.sheavly/settings.json` is there, by looking at it only: nothing is opened or
 * read, so a directory, a FIFO or a huge file costs nothing. A file that cannot even be examined
 * (permissions) counts as there, so the caller treats it with the care a real file gets. The
 * backend asks this first and skips the trust check when there is no file.
 */
export async function projectSettingsFileExists(params: { root: string }): Promise<boolean> {
  try {
    await stat(projectSettingsPath(params));

    return true;
  } catch (caughtError) {
    return !isMissingPath(caughtError);
  }
}

/**
 * The text of `<root>/.sheavly/settings.json`, which is repository content and so untrusted, or
 * `undefined` when there is no such file (an empty layer). It is read through the same confinement
 * as the project hooks' files: the real `.sheavly/` folder must be a plain folder directly inside
 * the project (not a link out of it), the file must stay inside it (a link to a file elsewhere is
 * refused), a `.env` name is refused, and the file must be a regular file of at most
 * `MAX_PROJECT_SETTINGS_BYTES`, checked before it is read, in valid UTF-8.
 *
 * It never throws for a file it can't use: it returns `ok: false` with the path and the reason,
 * which never quotes the file's content, for the caller to report and treat as an empty layer.
 * Trust is the caller's: this neither checks nor grants it. The text is not parsed here.
 */
export async function readProjectSettings(params: {
  root: string;
}): Promise<ProjectSettingsRead | undefined> {
  const shown = projectSettingsPath(params);

  try {
    const real = await resolveSettingsFile({ root: params.root });

    if (real === undefined) return undefined;

    return { ok: true, text: await readCappedText({ real }), path: shown };
  } catch (caughtError) {
    // A file that vanished is the same as one never there; every other failure is reported.
    if (isMissingPath(caughtError)) return undefined;

    return { ok: false, path: shown, reason: causeOf(caughtError) };
  }
}

/**
 * The fixed cause of a refusal, mapped here at the source so no message or system text travels
 * further: the reader's own refusals carry their code; the sandbox's refusal of a path that
 * leaves `.sheavly/` or names a `.env` file is a link; anything else could not be read.
 */
function causeOf(caughtError: unknown): ProjectSettingsCause {
  if (caughtError instanceof ProjectSettingsError) return caughtError.code;

  if (caughtError instanceof WorkspaceError || caughtError instanceof ToolCallError) return 'link';

  return 'unreadable';
}

/**
 * The real path of the settings file, or `undefined` when `.sheavly/` is missing. The folder is
 * checked by its real path here because `Workspace.open` would take a link to a folder elsewhere
 * as the workspace itself.
 */
async function resolveSettingsFile(params: { root: string }): Promise<string | undefined> {
  const realRoot = await realpath(path.resolve(params.root));
  const dir = path.join(realRoot, SHEAVLY_DIR);
  const realDir = await realpath(dir).catch((caughtError: unknown) => {
    if (isMissingPath(caughtError)) return undefined;
    throw caughtError;
  });

  if (realDir === undefined) return undefined;

  if (realDir !== dir) {
    throw new ProjectSettingsError(
      'link',
      `${SHEAVLY_DIR} is not a plain folder inside the project (it is a link)`,
    );
  }

  return resolveGuardedFile({
    folder: await Workspace.open(realDir),
    file: PROJECT_SETTINGS_FILE,
  });
}

/** The file's text once it is known to be a regular file within the cap; the cap is checked again on what was read. */
async function readCappedText(params: { real: string }): Promise<string> {
  const { real } = params;
  const found = await stat(real);

  if (!found.isFile()) throw new ProjectSettingsError('not-a-file', 'it is not a regular file');

  assertWithinCap(found.size);

  const bytes = await readFile(real);

  // The file may have grown between the stat and the read.
  assertWithinCap(bytes.length);

  return decodeUtf8(bytes);
}

function assertWithinCap(size: number): void {
  if (size <= MAX_PROJECT_SETTINGS_BYTES) return;

  throw new ProjectSettingsError(
    'too-large',
    `it is larger than ${MAX_PROJECT_SETTINGS_BYTES} bytes`,
  );
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (caughtError) {
    throw new ProjectSettingsError('not-utf8', 'it is not valid UTF-8', { cause: caughtError });
  }
}
