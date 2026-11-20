import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { ServerVersionError } from '../../errors/server-version.errors.js';
import { readServerVersion } from '../server-version.helper.js';

const folders = useTempFolders({ prefix: 'server-version-', names: [] });

/** A package.json holding `text`, as a file URL. */
async function packageWith(text: string): Promise<URL> {
  const file = `${folders.base}/package.json`;

  await writeFile(file, text);

  return pathToFileURL(file);
}

describe('readServerVersion', () => {
  it('reads the backend’s own package.json by default, a semantic version', async () => {
    expect(await readServerVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads the version of a package.json', async () => {
    expect(await readServerVersion(await packageWith('{"version":"1.2.3-beta.1"}'))).toBe(
      '1.2.3-beta.1',
    );
  });

  it('fails with an unreadable error for a missing file and for malformed JSON', async () => {
    const missing = pathToFileURL(`${folders.base}/absent.json`);

    await expect(readServerVersion(missing)).rejects.toMatchObject({
      name: 'ServerVersionError',
      reason: 'unreadable',
    });
    await expect(readServerVersion(await packageWith('{ nope'))).rejects.toBeInstanceOf(
      ServerVersionError,
    );
  });

  it.each([
    ['has no version', '{}'],
    ['has a number', '{"version":1}'],
    ['is not semver', '{"version":"1.2"}'],
    ['has build metadata', '{"version":"1.2.3+build"}'],
  ])('fails with an invalid error when the version %s', async (_name, text) => {
    await expect(readServerVersion(await packageWith(text))).rejects.toMatchObject({
      name: 'ServerVersionError',
      reason: 'invalid',
    });
  });
});
