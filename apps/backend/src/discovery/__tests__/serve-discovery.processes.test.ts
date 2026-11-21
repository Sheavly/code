import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyServer } from '@sheavly/client/client/verify.helper';
import { discoveryFileSchema } from '@sheavly/protocol/discovery/discovery.validator';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { serverNameHash } from '@sheavly/storage/server-runtime/server-runtime.helper';
import { newInstanceId } from '../../instance/instance-id.helper.js';
import { useServeProcesses } from '../../testing/serve-process.fake.js';
import { readServerVersion } from '../../version/server-version.helper.js';

const places = useServeProcesses();

/** Where the server of the test's home keeps its socket and its file: `<xdg>/sheavly/<hash12>`. */
async function runtimeFolder(): Promise<string> {
  const { xdg, home } = places.folders();

  return path.join(xdg, 'sheavly', await serverNameHash({ home }));
}

async function readPublished(): Promise<string> {
  return readFile(path.join(await runtimeFolder(), 'server.json'), 'utf8');
}

describe.skipIf(process.platform === 'win32')('an always-on server', () => {
  it('publishes a private, valid server.json with its real address that the handshake proves', async () => {
    const { token } = places.folders();
    const server = await places.start();
    const file = path.join(await runtimeFolder(), 'server.json');
    const published = discoveryFileSchema.parse(JSON.parse(await readPublished()));

    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(published).toMatchObject({
      url: server.url,
      token,
      pid: server.pid,
      serverVersion: await readServerVersion(),
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(published.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await verifyServer({ ...published })).toEqual({
      status: 'verified',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(await verifyServer({ ...published, instanceId: newInstanceId() })).toEqual({
      status: 'wrong_server',
    });
    // The token is in the file, and nowhere the server printed.
    expect(server.stdout() + server.stderr()).not.toContain(token);
  }, 60_000);

  it('refuses a second server on the same home: exit 1, names the first, no token, nothing changed', async () => {
    const { token } = places.folders();
    const first = await places.start();
    const before = await readPublished();
    const second = await places.startAndWaitForExit();

    expect(await second.exited).toEqual({ code: 1, signal: null });
    expect(second.stderr()).toContain('Another Sheavly server is already running');
    expect(second.stderr()).toContain(`pid ${String(first.pid)}`);
    expect(second.stderr()).toContain(new URL(first.url).origin);
    expect(second.stdout() + second.stderr()).not.toContain(token);
    // It did nothing before it was refused: it printed nothing and left the first one's file.
    expect(second.stdout()).toBe('');
    expect(await readPublished()).toBe(before);
  }, 60_000);

  it('removes its file and socket on SIGTERM and exits 143', async () => {
    const server = await places.start();
    const folder = await runtimeFolder();

    expect((await readdir(folder)).sort()).toEqual([
      expect.stringMatching(/\.sock$/),
      'server.json',
    ]);

    expect(await server.stop('SIGTERM')).toEqual({ code: 143, signal: null });
    expect(await readdir(folder)).toEqual([]);
    expect(server.stdout()).toContain('→ stopped');
  }, 60_000);

  it('leaves its file and socket when killed, and the next server replaces the file', async () => {
    const first = await places.start();
    const folder = await runtimeFolder();

    await first.stop('SIGKILL');

    expect(JSON.parse(await readPublished())).toMatchObject({ pid: first.pid });
    expect((await readdir(folder)).sort()).toEqual([
      expect.stringMatching(/\.sock$/),
      'server.json',
    ]);

    const next = await places.start();
    const replaced = discoveryFileSchema.parse(JSON.parse(await readPublished()));

    expect(next.pid).not.toBe(first.pid);
    expect(replaced).toMatchObject({ pid: next.pid, url: next.url });
  }, 60_000);
});
