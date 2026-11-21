import { chmod, lstat, mkdir, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach } from 'vitest';
import { DISCOVERY_FILE_NAME } from '@sheavly/protocol/discovery/discovery.constants';
import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';
import {
  plantFile,
  sampleDiscoveryFile,
} from '../../discovery-file/testing/discovery-file.fake.js';
import { publishDiscoveryFile } from '../../discovery-file/publish-discovery-file.helper.js';
import { acquireServerLock } from '../../server-lock/server-lock.helper.js';
import type { ServerLockResult } from '../../server-lock/server-lock.types.js';
import { serverNameHash } from '../../server-runtime/server-runtime.helper.js';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import type {
  FinderVerify,
  FinderVerifyParams,
  FinderVerifyResult,
} from '../server-finder.types.js';

/** Test-only: the token of `sampleDiscoveryFile`, which a leak is searched for. */
export const SAMPLE_TOKEN = sampleDiscoveryFile().token;

/**
 * Test-only: a home, a private `$XDG_RUNTIME_DIR` and helpers to give the home's server a runtime
 * folder, a held lock and a published file, in the test's own temp folder. Every lock taken is
 * released when the test ends.
 */
export function useFinderPlace(): {
  uid: number;
  home: () => string;
  xdg: () => string;
  env: () => { XDG_RUNTIME_DIR: string };
  /** The private folder a server of `home` publishes in under the runtime folder. */
  runtimeFolder: (home?: string) => Promise<string>;
  /** Makes `directory` (with its parents) private to the user. */
  privateFolder: (directory: string) => Promise<string>;
  /** Holds the lock of `home` with its socket in `directory`; released after the test. */
  hold: (params: { directory: string; home?: string }) => Promise<ServerLockResult>;
  publish: (params: {
    directory: string;
    overrides?: Partial<Record<keyof DiscoveryFile, unknown>>;
  }) => Promise<void>;
  /** Writes `text` as the file of `directory`, private to the user, valid or not. */
  publishText: (params: { directory: string; text: string }) => Promise<void>;
  /** Makes `directory` writable by its group. */
  openFolder: (directory: string) => Promise<void>;
  /** Plants a file the reader must refuse: a link to a valid file, or a valid one of `mode`. */
  plant: (params: { directory: string; as: 'link' | { mode: number } }) => Promise<void>;
  /** Every path under `root` with its mtime, to compare before and after a read. */
  snapshot: (root: string) => Promise<string[]>;
} {
  const temp = useTempFolder('server-finder-');
  const taken: ServerLockResult[] = [];
  const uid = process.getuid?.() ?? 0;
  const home = (): string => path.join(temp.path(), 'home');
  const xdg = (): string => path.join(temp.path(), 'xdg');
  const privateFolder = async (directory: string): Promise<string> => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);

    return directory;
  };

  afterEach(async () => {
    for (const result of taken.splice(0)) {
      if (result.status === 'acquired') await result.release();
    }
  });

  return {
    uid,
    home,
    xdg,
    env: () => ({ XDG_RUNTIME_DIR: xdg() }),
    runtimeFolder: async (forHome = home()) => {
      await privateFolder(xdg());
      await privateFolder(path.join(xdg(), 'sheavly'));

      return privateFolder(path.join(xdg(), 'sheavly', await serverNameHash({ home: forHome })));
    },
    privateFolder,
    hold: async ({ directory, home: forHome = home() }) => {
      await privateFolder(forHome);

      const result = await acquireServerLock({ home: forHome, runtimeDir: directory });

      taken.push(result);

      return result;
    },
    publish: async ({ directory, overrides }) => {
      await publishDiscoveryFile({ directory, uid, value: sampleDiscoveryFile(overrides) });
    },
    publishText: ({ directory, text }) =>
      plantFile({ file: path.join(directory, DISCOVERY_FILE_NAME), text }),
    openFolder: (directory) => chmod(directory, 0o770),
    plant: async ({ directory, as }) => {
      const text = `${JSON.stringify(sampleDiscoveryFile())}\n`;
      const file = path.join(directory, DISCOVERY_FILE_NAME);

      if (as === 'link') {
        const target = path.join(temp.path(), 'elsewhere.json');

        await plantFile({ file: target, text });
        await symlink(target, file);

        return;
      }

      await plantFile({ file, text, mode: as.mode });
    },
    snapshot: (root) => snapshotOf(root),
  };
}

async function snapshotOf(root: string): Promise<string[]> {
  const lines: string[] = [];

  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    const file = path.join(entry.parentPath, entry.name);

    lines.push(`${file} ${String((await lstat(file)).mtimeMs)}`);
  }

  return lines.sort();
}

/**
 * Test-only: a `verify` that gives `answers` one per call (the last repeats), throwing an answer
 * that is an error, and records its calls.
 */
export function sequencedVerify(answers: (FinderVerifyResult | Error)[]): FinderVerify & {
  calls: FinderVerifyParams[];
} {
  const calls: FinderVerifyParams[] = [];
  const verify = (params: FinderVerifyParams): Promise<FinderVerifyResult> => {
    const answer = answers[Math.min(calls.length, answers.length - 1)];

    calls.push(params);

    return answer instanceof Error || answer === undefined
      ? Promise.reject(answer ?? new Error('no answer scripted'))
      : Promise.resolve(answer);
  };

  return Object.assign(verify, { calls });
}

/** Test-only: a `verify` that always answers `answer` (or throws it, when it is an error). */
export function scriptedVerify(
  answer: FinderVerifyResult | Error,
): ReturnType<typeof sequencedVerify> {
  return sequencedVerify([answer]);
}
