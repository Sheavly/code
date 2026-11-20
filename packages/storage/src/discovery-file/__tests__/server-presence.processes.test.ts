import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDiscoveryFile } from '../read-discovery-file.helper.js';
import { sampleDiscoveryFile } from '../testing/discovery-file.fake.js';
import { usePresences } from '../testing/server-presence.fake.js';

const places = usePresences();
const WORKER = path.join(import.meta.dirname, '..', 'testing', 'discovery-file-worker.fake.ts');
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

function nextEvent(child: ChildProcess): Promise<{ status: string }> {
  return new Promise((resolve, reject) => {
    child.on('message', (event: { status: string }) => {
      if (event.status !== 'log') resolve(event);
    });
    child.once('exit', () => {
      reject(new Error('the server ended before it said anything'));
    });
  });
}

describe.skipIf(process.platform === 'win32')(
  'a server killed without a chance to clean up',
  () => {
    it('leaves its file and socket, and the next server claims and replaces the file', async () => {
      const child = fork(WORKER, ['server', places.home(), `child-${'c'.repeat(40)}`], {
        execArgv: ['--conditions=@sheavly/source', '--import', 'tsx'],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });

      children.push(child);

      expect(await nextEvent(child)).toEqual({ status: 'claimed' });

      const exited = new Promise((resolve) => child.once('exit', resolve));

      child.kill('SIGKILL');
      await exited;

      const directory = await realpath(places.home());
      const stale = await readDiscoveryFile({ directory, uid: places.uid });

      expect(stale).toMatchObject({ status: 'found', value: { pid: child.pid } });
      expect((await readdir(directory)).sort()).toEqual([
        expect.stringMatching(/\.sock$/),
        'server.json',
      ]);

      const { presence, logs } = places.make();
      const replacement = sampleDiscoveryFile({ pid: 31, token: `next-${'t'.repeat(40)}` });

      expect(await presence.claim()).toEqual({ status: 'claimed' });
      await presence.publish(replacement);

      expect(await readDiscoveryFile({ directory, uid: places.uid })).toEqual({
        status: 'found',
        value: replacement,
      });
      expect(logs).toEqual([]);
    }, 30_000);
  },
);
