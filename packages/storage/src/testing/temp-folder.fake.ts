import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect } from 'vitest';

/**
 * Test-only: a folder under the system's temp folder, made for each test and removed after it. Call
 * it in a `describe`; `path()` is the folder of the test running (a new one each time).
 */
export function useTempFolder(prefix: string): { path: () => string } {
  let folder = '';

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), prefix));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return { path: () => folder };
}

/**
 * Test-only: `file` is readable by its owner alone, and so is the folder it is in (`0600`, `0700`).
 * Windows has no file modes: skip the test there (`it.skipIf(process.platform === 'win32')`).
 */
export async function expectPrivate(file: string): Promise<void> {
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
}
