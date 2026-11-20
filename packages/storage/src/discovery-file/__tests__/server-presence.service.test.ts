import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDiscoveryFile } from '../read-discovery-file.helper.js';
import type { FirstServer } from '../server-presence.types.js';
import { describeHeld } from '../server-presence.utils.js';
import { deepFolder, usePresences } from '../testing/server-presence.fake.js';
import { sampleDiscoveryFile } from '../testing/discovery-file.fake.js';

const places = usePresences();
const posix = it.skipIf(process.platform === 'win32');
const value = sampleDiscoveryFile();

async function folderOf(home: string): Promise<string> {
  return realpath(home);
}

describe('ServerPresence.claim', () => {
  it('claims a free home, and gives the same answer when asked again', async () => {
    const { presence, logs } = places.make();
    const first = await presence.claim();

    expect(first).toEqual({ status: 'claimed' });
    expect(await presence.claim()).toBe(first);
    expect(logs).toEqual([]);
  });

  it('is held by a server that has published, and says who it is without its token', async () => {
    const first = places.make();
    const second = places.make();

    await first.presence.claim();
    await first.presence.publish(value);

    const result = await second.presence.claim();

    expect(result).toMatchObject({ status: 'held' });

    if (result.status !== 'held') throw new Error('not held');

    expect(result.first).toEqual({
      pid: 4242,
      url: 'http://127.0.0.1:4317',
      serverVersion: '1.2.3',
    });
    expect(JSON.stringify(result)).not.toContain(value.token);
    expect(describeHeld(result)).toBe(
      'Another Sheavly server is already running (pid 4242, version 1.2.3, http://127.0.0.1:4317). Use it, or stop it first.',
    );
  });

  it('is held, with the reason, by a server that has not published yet', async () => {
    const first = places.make();
    const second = places.make();

    await first.presence.claim();

    const result = await second.presence.claim();

    if (result.status !== 'held') throw new Error('not held');

    expect(result.first).toEqual({ unreadable: 'it has not written one yet' });
    expect(describeHeld(result)).toBe(
      `A Sheavly server holds the lock at ${result.path}; its discovery file could not be read (it has not written one yet).`,
    );
  });

  posix('runs without a lock, with a warning, when the folder is not a folder', async () => {
    const home = places.home();

    await mkdir(path.dirname(home), { recursive: true });
    await writeFile(home, 'a file where the folder should be');

    const { presence, logs } = places.make();

    expect(await presence.claim()).toEqual({ status: 'unavailable' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^Warning: .*runs without/);

    await presence.publish(value);

    expect(logs).toHaveLength(1);
  });

  posix('runs without a lock, with a warning, when the socket path is too long', async () => {
    const home = await deepFolder({
      root: path.dirname(places.home()),
      name: 'x'.repeat(30),
      depth: 4,
    });
    const { presence, logs } = places.make({ home });

    expect(await presence.claim()).toEqual({ status: 'unavailable' });
    expect(logs.join('\n')).toContain('path-too-long');
    expect(logs.join('\n')).not.toContain(value.token);
  });

  posix('claims with a warning when XDG_RUNTIME_DIR cannot be used', async () => {
    const { presence, logs } = places.make({ env: { XDG_RUNTIME_DIR: 'relative/path' } });

    expect(await presence.claim()).toEqual({ status: 'claimed' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('XDG_RUNTIME_DIR');
  });
});

describe('ServerPresence.publish', () => {
  posix('writes a valid private file while the lock stays held', async () => {
    const { presence } = places.make();
    const other = places.make();

    await presence.claim();
    await presence.publish(value);

    const directory = await folderOf(places.home());

    expect(await readDiscoveryFile({ directory, uid: places.uid })).toEqual({
      status: 'found',
      value,
    });
    expect((await stat(path.join(directory, 'server.json'))).mode & 0o777).toBe(0o600);
    expect((await other.presence.claim()).status).toBe('held');
  });

  it('does nothing, and says nothing, without a claim or after a held claim', async () => {
    const unclaimed = places.make();
    const first = places.make();
    const second = places.make();

    await unclaimed.presence.publish(value);
    await first.presence.claim();
    await first.presence.publish(value);
    await second.presence.claim();
    await second.presence.publish(sampleDiscoveryFile({ pid: 1, token: `other-${value.token}` }));

    const directory = await folderOf(places.home());

    expect(await readDiscoveryFile({ directory, uid: places.uid })).toEqual({
      status: 'found',
      value,
    });
    expect([unclaimed.logs, second.logs]).toEqual([[], []]);
  });

  posix('turns every failure into a warning, never an exception, without the token', async () => {
    const { presence, logs } = places.make();

    await presence.claim();
    // A folder at the file's name: the file cannot be written.
    await mkdir(path.join(await folderOf(places.home()), 'server.json'));
    await presence.publish(value);
    await presence.publish({ ...value, token: 'too-short' });

    expect(logs).toHaveLength(2);
    expect(
      logs.every((line) => line.startsWith('Warning: The discovery file was not written')),
    ).toBe(true);
    expect(logs.join('\n')).not.toContain(value.token);
  });
});

describe('ServerPresence.remove and release', () => {
  it('removes the file, frees the lock, and lets the next server claim', async () => {
    const first = places.make();
    const second = places.make();
    const third = places.make();

    await first.presence.claim();
    await first.presence.publish(value);

    const directory = await folderOf(places.home());

    await first.presence.remove();

    expect(await readdir(directory)).not.toContain('server.json');
    expect((await second.presence.claim()).status).toBe('held');

    await first.presence.release();

    expect((await third.presence.claim()).status).toBe('claimed');
  });

  it('can be called twice, and release before remove is still safe', async () => {
    const { presence, logs } = places.make();

    await presence.claim();
    await presence.publish(value);
    await presence.release();
    await presence.release();
    await presence.remove();
    await presence.remove();

    expect(await readdir(await folderOf(places.home()))).not.toContain('server.json');
    expect(logs).toEqual([]);
  });

  it('leaves the file of a successor that published after this one let go', async () => {
    const first = places.make();
    const successor = places.make();
    const next = sampleDiscoveryFile({ instanceId: 'B'.repeat(43), pid: 9 });

    await first.presence.claim();
    await first.presence.publish(value);
    await first.presence.release();
    await successor.presence.claim();
    await successor.presence.publish(next);
    await first.presence.remove();

    expect(
      await readDiscoveryFile({ directory: await folderOf(places.home()), uid: places.uid }),
    ).toEqual({
      status: 'found',
      value: next,
    });
  });
});

describe('ServerPresence once released', () => {
  it('is closed: a later claim takes nothing, says nothing, and publish writes nothing', async () => {
    const first = places.make();
    const other = places.make();

    await first.presence.claim();
    await first.presence.release();

    expect(await first.presence.claim()).toEqual({ status: 'unavailable' });

    await first.presence.publish(value);

    expect(first.logs).toEqual([]);
    expect(await readdir(await folderOf(places.home()))).not.toContain('server.json');
    expect((await other.presence.claim()).status).toBe('claimed');
  });

  it('is closed when released before any claim, and acquires nothing afterwards', async () => {
    const first = places.make();
    const other = places.make();

    await first.presence.release();

    expect(await first.presence.claim()).toEqual({ status: 'unavailable' });
    expect(first.logs).toEqual([]);
    expect((await other.presence.claim()).status).toBe('claimed');
  });

  it('releases a lock that a claim still in flight takes, and does not leak it', async () => {
    const first = places.make();
    const other = places.make();
    const claiming = first.presence.claim();

    await first.presence.release();
    await claiming;

    expect((await other.presence.claim()).status).toBe('claimed');
  });

  it('releases once when called twice at the same time as a claim', async () => {
    const first = places.make();
    const other = places.make();
    const claiming = first.presence.claim();

    await Promise.all([first.presence.release(), first.presence.release(), claiming]);

    expect(first.logs).toEqual([]);
    expect((await other.presence.claim()).status).toBe('claimed');
  });

  it('answers concurrent claims alike while open', async () => {
    const { presence } = places.make();
    const [one, two] = await Promise.all([presence.claim(), presence.claim()]);

    expect(one).toBe(two);
    expect(one).toEqual({ status: 'claimed' });
  });
});

describe('describeHeld', () => {
  it('prints only the origin of the url, never a login, a path or a query', () => {
    const first: FirstServer = {
      pid: 7,
      serverVersion: '1.2.3',
      url: 'http://user:s3cret@127.0.0.1:4310/private/path?token=abc#frag',
    };
    const message = describeHeld({ path: '/run/x.sock', first });

    expect(message).toBe(
      'Another Sheavly server is already running (pid 7, version 1.2.3, http://127.0.0.1:4310). Use it, or stop it first.',
    );

    for (const secret of ['user', 's3cret', 'private', 'token=abc', 'frag']) {
      expect(message).not.toContain(secret);
    }
  });

  it.each(['not a url', 'data:text/plain,secret', ''])(
    'prints a fixed word for the url %j, which has no origin',
    (url) => {
      const message = describeHeld({
        path: '/run/x.sock',
        first: { pid: 7, serverVersion: '1.2.3', url },
      });

      expect(message).toBe(
        'Another Sheavly server is already running (pid 7, version 1.2.3, unknown address). Use it, or stop it first.',
      );
    },
  );

  it('is built from the three fields of a server only, so a token in what it is given never shows', () => {
    // A whole file, token and all, is accepted where a `FirstServer` is: the type is the guard.
    const leaky: FirstServer = value;
    const message = describeHeld({ path: '/run/x.sock', first: leaky });

    expect(message).toContain('pid 4242');
    expect(message).not.toContain(value.token);
    expect(message).not.toContain(value.instanceId);
  });
});
