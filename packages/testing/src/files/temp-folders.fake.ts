import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/** The folders `useTempFolders` made: `base`, and one path for each name asked for. */
type TempFolders<Name extends string> = { readonly base: string } & Readonly<Record<Name, string>>;

/**
 * Test-only: a temp folder for each test, with the folders `names` made in it, removed after the
 * test. Call it in a `describe`; read `base` and each name inside the tests (`folders.app`), since
 * a new set is made for each. A path in `base` that is not in `names` (a user's home on a first
 * run) does not exist until something makes it.
 */
export function useTempFolders<const Name extends string>(params: {
  prefix: string;
  names: readonly Name[];
}): TempFolders<Name> {
  const { prefix, names } = params;
  let base = '';

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), prefix));

    for (const name of names) await mkdir(path.join(base, name), { recursive: true });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const folders = {
    get base() {
      return base;
    },
  };

  for (const name of names) {
    Object.defineProperty(folders, name, { get: () => path.join(base, name), enumerable: true });
  }

  return folders as TempFolders<Name>;
}
