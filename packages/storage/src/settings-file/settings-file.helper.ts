import { readFile, stat } from 'node:fs/promises';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError } from '../errors/storage.errors.js';
import { MAX_SETTINGS_FILE_BYTES } from './settings-file.constants.js';
import type { SettingsFileText } from './settings-file.types.js';

/**
 * The text of the settings file `file`, or `undefined` when there is no such file (an empty
 * layer). The text is not parsed here: the setting grammar is `@sheavly/extension`'s, which sits
 * above storage, so the caller parses it with `file` as the source of its messages.
 *
 * Anything else wrong with it throws a `StorageFileError` naming `file` and the reason, never the
 * content: it is not a regular file (a folder, a FIFO: refused before it is opened), it is larger
 * than `MAX_SETTINGS_FILE_BYTES`, it cannot be read (permissions), or it is not valid UTF-8. The
 * file is read once.
 */
export async function readSettingsFile(params: {
  file: string;
}): Promise<SettingsFileText | undefined> {
  const { file } = params;
  const found = await statFile({ file });

  if (found === undefined) return undefined;

  if (!found.isFile()) {
    throw new StorageFileError({ file, cause: undefined, reason: 'it is not a regular file' });
  }

  assertWithinCap({ file, size: found.size });

  const bytes = await readFile(file).catch((caughtError: unknown) => {
    // A file that vanished since the check is the same as one never there.
    if (isMissingPath(caughtError)) return undefined;
    throw new StorageFileError({ file, cause: caughtError });
  });

  if (bytes === undefined) return undefined;

  // The file may have grown between the check and the read.
  assertWithinCap({ file, size: bytes.length });

  return { text: decodeUtf8({ file, bytes }), file };
}

async function statFile(params: { file: string }) {
  try {
    return await stat(params.file);
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return undefined;
    throw new StorageFileError({ file: params.file, cause: caughtError });
  }
}

function assertWithinCap(params: { file: string; size: number }): void {
  if (params.size <= MAX_SETTINGS_FILE_BYTES) return;

  throw new StorageFileError({
    file: params.file,
    cause: undefined,
    reason: `it is larger than ${MAX_SETTINGS_FILE_BYTES} bytes`,
  });
}

function decodeUtf8(params: { file: string; bytes: Uint8Array }): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(params.bytes);
  } catch (caughtError) {
    // The reason is fixed: the decoder's own message is not relied on to keep the file's bytes out.
    throw new StorageFileError({
      file: params.file,
      cause: caughtError,
      reason: 'it is not valid UTF-8',
    });
  }
}
