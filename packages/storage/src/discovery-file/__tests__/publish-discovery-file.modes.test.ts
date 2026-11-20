import { stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishDiscoveryFile } from '../publish-discovery-file.helper.js';
import { sampleDiscoveryFile, useDiscoveryFolder } from '../testing/discovery-file.fake.js';

const folder = useDiscoveryFolder();
const posix = describe.skipIf(process.platform === 'win32');

// The pool is `forks`, so each test file has its own process and its own umask to change.
posix('the mode of the published file, whatever the umask of the process', () => {
  it.each([
    ['0 (nothing stripped)', 0o000],
    ['077 (the usual private one)', 0o077],
    ['0277 (strips the owner’s write and read)', 0o277],
  ])('is 0600 under umask %s', async (_name, umask) => {
    const directory = await folder.directory();
    const before = process.umask(umask);

    try {
      const result = await publishDiscoveryFile({
        directory,
        uid: folder.uid,
        value: sampleDiscoveryFile(),
      });

      expect(result.status).toBe('published');
    } finally {
      process.umask(before);
    }

    expect((await stat(path.join(directory, 'server.json'))).mode & 0o777).toBe(0o600);
  });
});
