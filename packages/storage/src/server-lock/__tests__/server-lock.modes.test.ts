import { stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const { place, acquire } = useLockPlace();
const posix = describe.skipIf(process.platform === 'win32');

// The pool is `forks`, so each test file has its own process and its own umask to change.
posix('the mode of the lock socket, whatever the umask of the process', () => {
  it.each([
    ['0 (nothing stripped)', 0o000],
    ['022 (the usual one)', 0o022],
    ['077 (the usual private one)', 0o077],
    ['0277 (strips the owner’s write and read)', 0o277],
  ])('is 0600 under umask %s', async (_name, umask) => {
    const where = place();
    const before = process.umask(umask);
    let result: Awaited<ReturnType<typeof acquire>>;

    try {
      result = await acquire(where);
    } finally {
      process.umask(before);
    }

    expect(result.status).toBe('acquired');

    if (result.status !== 'acquired') return;

    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  });
});
