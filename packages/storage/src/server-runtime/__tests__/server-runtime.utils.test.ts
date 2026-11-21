import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  hashResolvedHome,
  isProcessRunning,
  serverEndpoint,
  socketPathBytes,
} from '../server-runtime.utils.js';

describe('isProcessRunning', () => {
  it('is true for this process and for pid 1, which this user cannot signal (EPERM)', () => {
    expect(isProcessRunning(process.pid)).toBe(true);
    expect(isProcessRunning(1)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN, 4_194_305, Number.MAX_SAFE_INTEGER])(
    'is false for %s, which is no process to ask about',
    (pid) => {
      expect(isProcessRunning(pid)).toBe(false);
    },
  );

  it('is false for the pid of a process that has ended', () => {
    const ended = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);

    expect(isProcessRunning(Number(ended.stdout.toString()))).toBe(false);
  });
});

describe('hashResolvedHome', () => {
  it('is 12 hex characters, stable, and different for different homes', () => {
    const hash = hashResolvedHome('/home/a/.sheavly');

    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hashResolvedHome('/home/a/.sheavly')).toBe(hash);
    expect(hashResolvedHome('/home/b/.sheavly')).not.toBe(hash);
  });
});

describe('serverEndpoint', () => {
  it('is a socket file in the runtime folder on POSIX systems', () => {
    expect(
      serverEndpoint({ platform: 'linux', runtimeDir: '/run/user/1000/sheavly', hash: 'abc' }),
    ).toBe('/run/user/1000/sheavly/abc.sock');
  });

  it('is a named pipe on Windows, whatever the folder', () => {
    expect(serverEndpoint({ platform: 'win32', runtimeDir: 'C:\\x', hash: 'abc123abc123' })).toBe(
      '\\\\.\\pipe\\sheavly-abc123abc123',
    );
  });
});

describe('socketPathBytes', () => {
  it('counts the bytes of the path the lock will use, before the hash is known', () => {
    const runtimeDir = '/run/user/1000/sheavly';
    const real = serverEndpoint({ platform: 'linux', runtimeDir, hash: hashResolvedHome('/x') });

    expect(socketPathBytes(runtimeDir)).toBe(Buffer.byteLength(real));
  });
});
