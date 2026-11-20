import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';
import { discoveryFileSchema } from '@sheavly/protocol/discovery/discovery.validator';
import { useTempFolder } from '../../testing/temp-folder.fake.js';

/**
 * Test-only: a complete discovery file, with `overrides` on top. Its token is as long and as
 * random-looking as a real one, so a leak is found by its text.
 */
export function sampleDiscoveryFile(
  overrides: Partial<Record<keyof DiscoveryFile, unknown>> = {},
): DiscoveryFile {
  return discoveryFileSchema.parse({
    formatVersion: 1,
    url: 'http://127.0.0.1:4317',
    token: 'k3Y9-realistic_token_AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    instanceId: 'a-_'.repeat(14).concat('Z'),
    pid: 4242,
    serverVersion: '1.2.3',
    protocolVersion: '0.9.0',
    ...overrides,
  });
}

/** Test-only: the pid of a process that has already ended. */
export function deadProcessId(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

/**
 * Test-only: the name of a publish's temp file for `pid`, made of `fill` repeated so that each
 * name is its own.
 */
export function tempFileName(params: { pid: number | string; fill: string }): string {
  return `server.json.${String(params.pid)}.${params.fill.repeat(8)}.tmp`;
}

/** Test-only: a file at `file` holding `text`, of exactly `mode` whatever the umask says. */
export async function plantFile(params: {
  file: string;
  text: string;
  mode?: number;
}): Promise<void> {
  const { file, text, mode = 0o600 } = params;

  await writeFile(file, text);
  await chmod(file, mode);
}

/**
 * Test-only: a private runtime folder in the test's own temp folder, and the names in it. `uid` is
 * the user running the test.
 */
export function useDiscoveryFolder(): {
  /** Makes a private folder, `runtime` unless another name is given for a second one. */
  directory: (name?: string) => Promise<string>;
  names: (directory: string) => Promise<string[]>;
  uid: number;
} {
  const temp = useTempFolder('discovery-file-');

  return {
    directory: async (name = 'runtime') => {
      const directory = path.join(temp.path(), name);

      await mkdir(directory, { mode: 0o700 });
      await chmod(directory, 0o700);

      return directory;
    },
    names: async (directory) => (await readdir(directory)).sort(),
    uid: process.getuid?.() ?? 0,
  };
}
