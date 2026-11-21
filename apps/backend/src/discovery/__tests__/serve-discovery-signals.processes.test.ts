import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverNameHash } from '@sheavly/storage/server-runtime/server-runtime.helper';
import { useServeProcesses } from '../../testing/serve-process.fake.js';
import type { ServeProcess } from '../../testing/serve-process.types.js';

const places = useServeProcesses();
const POLL_MS = 1;
const APPEARS_TIMEOUT_MS = 40_000;

async function runtimeFolder(): Promise<string> {
  const { xdg, home } = places.folders();

  return path.join(xdg, 'sheavly', await serverNameHash({ home }));
}

async function leftovers(): Promise<string[]> {
  const folder = await runtimeFolder();

  return existsSync(folder) ? (await readdir(folder)).sort() : [];
}

/** Starts the real server and signals it as soon as its `server.json` exists, token inside. */
async function signalWhenPublished(signal: NodeJS.Signals) {
  const server = places.begin();
  const deadline = performance.now() + APPEARS_TIMEOUT_MS;

  // The folder's name hashes the home's real path, so it is only known once the server made it.
  while (performance.now() < deadline) {
    if (existsSync(path.join(await runtimeFolder(), 'server.json'))) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return server.stop(signal);
}

/** Starts the real server and signals it as soon as it has printed its `listening` line. */
async function signalWhenListening(signal: NodeJS.Signals) {
  return (await places.start()).stop(signal);
}

/** Starts the real server and polls until the runtime folder holds a file `wanted` accepts. */
async function startAndWaitForFile(wanted: (name: string) => boolean, extra = {}) {
  const server = places.begin(extra);
  const deadline = performance.now() + APPEARS_TIMEOUT_MS;

  while (performance.now() < deadline && !(await leftovers()).some(wanted)) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return server;
}

/** Signals the server, then expects exit 143, nothing printed as listening and an empty folder. */
async function expectStoppedSilently(server: ServeProcess) {
  expect(await server.stop('SIGTERM')).toEqual({ code: 143, signal: null });
  expect(server.stdout()).not.toContain('listening on');
  expect(await leftovers()).toEqual([]);
}

const SLOW_RENAME = path.join(import.meta.dirname, '..', '..', 'testing', 'slow-rename.fake.ts');

const MOMENTS = [
  ['server.json appears', signalWhenPublished],
  ['the listening line appears', signalWhenListening],
] as const;

const CASES = [
  ['SIGTERM', 143, 10],
  ['SIGHUP', 129, 4],
  ['SIGINT', 130, 4],
] as const;

describe.skipIf(process.platform === 'win32')('a signal while the server is starting', () => {
  it('does nothing more after a signal during the claim: no listen, no listening line, no file', async () => {
    for (let run = 0; run < 10; run++) {
      // The folder appears when the claim starts: the signal comes before the server listens.
      await expectStoppedSilently(await startAndWaitForFile(() => true));
    }
  }, 200_000);

  it('waits for the file being written, then removes it, when the signal comes mid-publish', async () => {
    for (let run = 0; run < 3; run++) {
      const server = await startAndWaitForFile((name) => /^server\.json\..+\.tmp$/.test(name), {
        // Imports run in this order: tsx first, so the preload may be TypeScript.
        NODE_OPTIONS: `--import tsx --import ${SLOW_RENAME}`,
      });

      await expectStoppedSilently(server);
    }
  }, 120_000);

  describe.each(CASES)('%s', (signal, code, repetitions) => {
    it.each(MOMENTS)(
      `exits ${String(code)} and leaves no file, no socket and no lock when it comes as %s`,
      async (_moment, signalAt) => {
        for (let run = 0; run < repetitions; run++) {
          // One folder for every run: a lock left behind would refuse the next start.
          expect(await signalAt(signal)).toEqual({ code, signal: null });
          expect(await leftovers()).toEqual([]);
        }
      },
      repetitions * 20_000,
    );
  });
});
