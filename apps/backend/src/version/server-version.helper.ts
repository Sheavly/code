import { readFile } from 'node:fs/promises';
import { serverVersionSchema } from '@sheavly/protocol/version/version.validator';
import type { ServerVersion } from '@sheavly/protocol/version/version.types';
import { z } from 'zod';
import { ServerVersionError } from '../errors/server-version.errors.js';
import { SERVER_PACKAGE_FILE } from './server-version.constants.js';

const packageSchema = z.object({ version: serverVersionSchema });

/** Reads and parses `file`'s JSON; a missing or malformed file is an `unreadable` failure. */
async function readJson(file: URL): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (caughtError) {
    throw new ServerVersionError({
      message: `Could not read the backend's version from ${file.pathname}`,
      reason: 'unreadable',
      cause: caughtError,
    });
  }
}

/**
 * The backend's own version: the `version` of its `package.json`, read once at startup (`file`
 * defaults to that package's own). Throws a `ServerVersionError` when the file cannot be read or
 * its version is not a semantic version, so the server does not start with nothing to report.
 */
export async function readServerVersion(
  file: URL = new URL(SERVER_PACKAGE_FILE, import.meta.url),
): Promise<ServerVersion> {
  const parsed = packageSchema.safeParse(await readJson(file));

  if (!parsed.success) {
    throw new ServerVersionError({
      message: `The version in ${file.pathname} is not a semantic version`,
      reason: 'invalid',
      cause: parsed.error,
    });
  }

  return parsed.data.version;
}
