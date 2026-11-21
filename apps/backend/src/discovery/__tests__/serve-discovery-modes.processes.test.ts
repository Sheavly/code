import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoveryFileSchema } from '@sheavly/protocol/discovery/discovery.validator';
import { ServerPresence } from '@sheavly/storage/discovery-file/server-presence.service';
import { serverNameHash } from '@sheavly/storage/server-runtime/server-runtime.helper';
import { useServeProcesses } from '../../testing/serve-process.fake.js';

const places = useServeProcesses();
const DEFAULT_PORT = 4310;
const occupied: Server[] = [];

afterEach(async () => {
  await Promise.all(
    occupied.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/** Takes `port` (0: any) on 127.0.0.1 as another program would; one already taken stays so. */
function occupy(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    occupied.push(server);
    server.once('error', (caughtError: NodeJS.ErrnoException) => {
      if (caughtError.code === 'EADDRINUSE') resolve(port);
      else reject(caughtError);
    });
    server.listen({ host: '127.0.0.1', port }, () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

async function freePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve));

  const { port } = server.address() as { port: number };

  await new Promise<void>((resolve) => server.close(() => resolve()));

  return port;
}

async function runtimeFolder(): Promise<string> {
  const { xdg, home } = places.folders();

  return path.join(xdg, 'sheavly', await serverNameHash({ home }));
}

async function namesIn(folder: string): Promise<string[]> {
  return existsSync(folder) ? (await readdir(folder)).sort() : [];
}

async function publishedIn(folder: string) {
  return discoveryFileSchema.parse(
    JSON.parse(await readFile(path.join(folder, 'server.json'), 'utf8')),
  );
}

describe.skipIf(process.platform === 'win32')('a server that is not discoverable', () => {
  it('takes no lock and writes no file with SERVER_EXIT_WITH_PARENT or SERVER_DISCOVERY=false, even while another server holds the lock', async () => {
    const holder = await places.start();
    const folder = await runtimeFolder();
    const before = await namesIn(folder);
    const [parented, silent] = await Promise.all([
      places.start({ SERVER_EXIT_WITH_PARENT: 'true' }),
      places.start({ SERVER_DISCOVERY: 'false' }),
    ]);

    expect(parented.stderr()).toBe('');
    expect(silent.stderr()).toBe('');
    expect(await namesIn(folder)).toEqual(before);
    expect(await publishedIn(folder)).toMatchObject({ pid: holder.pid, url: holder.url });
  }, 60_000);

  it('builds no presence at all: no runtime folder, no socket, no file', async () => {
    const { xdg, home } = places.folders();

    await Promise.all([
      places.start({ SERVER_EXIT_WITH_PARENT: 'true' }),
      places.start({ SERVER_DISCOVERY: 'false' }),
    ]);

    expect(await namesIn(xdg)).toEqual([]);
    expect(await namesIn(home)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.sock|server\.json|\.guard|\.tmp/)]),
    );
  }, 60_000);
});

describe.skipIf(process.platform === 'win32')('the port of a discoverable server', () => {
  it('moves a taken default port to another one and records that port in its file', async () => {
    await occupy(DEFAULT_PORT);

    const server = await places.start({ SERVER_PORT: undefined });
    const published = await publishedIn(await runtimeFolder());

    expect(new URL(server.url).port).not.toBe(String(DEFAULT_PORT));
    expect(published.url).toBe(server.url);
  }, 60_000);

  it('says on stdout, before the listening line, that the default port was taken', async () => {
    await occupy(DEFAULT_PORT);

    const server = await places.start({ SERVER_PORT: undefined });
    const { port } = new URL(server.url);
    const lines = server.stdout().trim().split('\n');
    const notice = `→ port ${String(DEFAULT_PORT)} is taken, so this server listens on ${port} instead (read the discovery file, not a fixed port)`;

    expect(lines.indexOf(notice)).toBeGreaterThan(-1);
    expect(lines.at(-1)).toBe(`→ listening on ${server.url}`);
    expect(lines.indexOf(notice)).toBeLessThan(lines.length - 1);
  }, 60_000);

  it('prints no such notice for a port that was asked for, free or port 0', async () => {
    const [explicit, anyPort] = await Promise.all([
      places.start({ SERVER_PORT: String(await freePort()) }),
      places.start({ SERVER_PORT: '0', SERVER_DISCOVERY: 'false' }),
    ]);

    expect(explicit.stdout()).not.toContain('is taken');
    expect(anyPort.stdout()).not.toContain('is taken');
  }, 60_000);

  it('fails an explicit taken port with EADDRINUSE and leaves no lock and no file', async () => {
    const { xdg, home } = places.folders();
    const port = await occupy(0);
    const server = await places.startAndWaitForExit({ SERVER_PORT: String(port) });
    const folder = await runtimeFolder();

    expect((await server.exited).code).not.toBe(0);
    expect(server.stderr()).toContain('EADDRINUSE');
    expect(await namesIn(folder)).toEqual([]);

    const presence = new ServerPresence({
      home,
      env: { XDG_RUNTIME_DIR: xdg },
      uid: process.getuid?.() ?? 0,
      log: () => undefined,
    });

    try {
      expect(await presence.claim()).toEqual({ status: 'claimed' });
    } finally {
      await presence.release();
    }
  }, 60_000);

  it('publishes a wildcard host as loopback with the port it really listens on', async () => {
    const port = await freePort();
    const server = await places.start({ SERVER_HOST: '0.0.0.0', SERVER_PORT: String(port) });
    const published = await publishedIn(await runtimeFolder());

    expect(server.url).toBe(`http://0.0.0.0:${String(port)}`);
    expect(published.url).toBe(`http://127.0.0.1:${String(port)}`);
  }, 60_000);
});

describe.skipIf(process.platform === 'win32')('a start that fails on a setting', () => {
  it('exits 1 with the error and leaves no socket and no file', async () => {
    const server = await places.startAndWaitForExit({ MODEL_RETRIES: '99' });

    expect(await server.exited).toMatchObject({ code: 1 });
    expect(server.stderr()).toContain('MODEL_RETRIES');
    expect(await namesIn(await runtimeFolder())).toEqual([]);
  }, 60_000);

  it('does not disturb the server that holds the lock', async () => {
    const holder = await places.start();
    const folder = await runtimeFolder();
    const before = await namesIn(folder);
    const second = await places.startAndWaitForExit({ MODEL_RETRIES: '99' });

    expect(await second.exited).toMatchObject({ code: 1 });
    expect(second.stderr()).toContain('MODEL_RETRIES');
    expect(second.stderr()).not.toContain('Another Sheavly server');
    expect(await namesIn(folder)).toEqual(before);
    expect(await publishedIn(folder)).toMatchObject({ pid: holder.pid, url: holder.url });
  }, 60_000);
});

describe.skipIf(process.platform === 'win32')('a lock or file problem that is not "held"', () => {
  it('warns and still listens, with no file, when the home is not private', async () => {
    const { home } = places.folders();

    await mkdir(home);
    await chmod(home, 0o755);

    const server = await places.start({ XDG_RUNTIME_DIR: undefined });

    expect(server.stderr()).toContain('Warning:');
    expect(await namesIn(home)).not.toContain('server.json');
    expect(await fetch(`${server.url}/health`).then((response) => response.status)).toBe(200);
  }, 60_000);

  it('warns about a runtime folder others can write to, and uses the home instead', async () => {
    const { xdg, home } = places.folders();

    await chmod(xdg, 0o777);

    const server = await places.start();

    expect(server.stderr()).toContain('XDG_RUNTIME_DIR');
    expect(server.stderr()).toContain('Warning:');
    expect(await namesIn(xdg)).toEqual([]);
    expect(await namesIn(home)).toContain('server.json');
  }, 60_000);
});
