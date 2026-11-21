import { createServer } from 'node:http';
import type { AddressInfo, ListenOptions } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoFreePortError } from '../../errors/listen.errors.js';
import {
  FALLBACK_PORT_ATTEMPTS,
  FALLBACK_PORT_MAX,
  FALLBACK_PORT_MIN,
} from '../listen.constants.js';
import { listenServer } from '../listen.helper.js';

const HOST = '127.0.0.1';
const opened: ReturnType<typeof createServer>[] = [];

function newServer() {
  const server = createServer((_request, response) => response.end('ready'));

  opened.push(server);

  return server;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    opened.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (server.listening) server.close(() => resolve());
          else resolve();
        }),
    ),
  );
});

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * Replaces `server.listen`: `fails(port)` returns an error code to emit, or undefined to accept the
 * port. An accepted port really listens only with `bind` (the default); without it the server just
 * reports `listening`, so a test that fixes the drawn ports cannot collide with a busy port on the
 * machine running it. Returns the ports it was asked for, in order.
 */
function spyOnListen(
  server: ReturnType<typeof createServer>,
  fails: (port: number) => string | undefined,
  { bind = true }: { bind?: boolean } = {},
): number[] {
  const original = server.listen.bind(server) as (options: ListenOptions) => unknown;
  const ports: number[] = [];

  vi.spyOn(server, 'listen').mockImplementation(((options: ListenOptions) => {
    const port = options.port ?? -1;
    const code = fails(port);

    ports.push(port);
    if (code === undefined && bind) return original(options);

    queueMicrotask(() =>
      code === undefined ? server.emit('listening') : server.emit('error', failure(code)),
    );

    return server;
  }) as unknown as typeof server.listen);

  return ports;
}

function startupListeners(server: ReturnType<typeof createServer>) {
  return { error: server.listenerCount('error'), listening: server.listeners('listening') };
}

/** The port for a `random()` value, as the fallback range maps it. */
function portFor(value: number): number {
  return FALLBACK_PORT_MIN + Math.floor(value * (FALLBACK_PORT_MAX - FALLBACK_PORT_MIN + 1));
}

describe('listenServer', () => {
  it('listens on port 0 normally and serves HTTP', async () => {
    const server = newServer();

    await listenServer({ server, host: HOST, port: 0 });

    const { port } = server.address() as AddressInfo;

    expect(await (await fetch(`http://${HOST}:${String(port)}`)).text()).toBe('ready');
  });

  it('rejects a taken fixed port with EADDRINUSE after one attempt, never moving it', async () => {
    const occupied = newServer();

    await listenServer({ server: occupied, host: HOST, port: 0 });

    const taken = (occupied.address() as AddressInfo).port;
    const server = newServer();
    const ports = spyOnListen(server, () => undefined);

    await expect(listenServer({ server, host: HOST, port: taken })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });

    expect(ports).toEqual([taken]);
    expect(server.listening).toBe(false);
  });

  it('moves a taken default port to the OS port when fallback is set', async () => {
    const server = newServer();
    const ports = spyOnListen(server, (port) => (port === 4310 ? 'EADDRINUSE' : undefined), {
      bind: false,
    });

    await listenServer({ server, host: HOST, port: 4310, fallback: true });

    expect(ports).toEqual([4310, 0]);
  });

  it('moves a taken default port to the fallback ports when the OS has none either', async () => {
    const server = newServer();
    const ports = spyOnListen(
      server,
      (port) => (port === 4310 || port === 0 ? 'EADDRINUSE' : undefined),
      { bind: false },
    );

    await listenServer({ server, host: HOST, port: 4310, fallback: true, random: () => 0.25 });

    expect(ports).toEqual([4310, 0, portFor(0.25)]);
  });

  it('rejects with no-free-port when a default port and every fallback are taken', async () => {
    const server = newServer();
    const ports = spyOnListen(server, () => 'EADDRINUSE', { bind: false });

    await expect(
      listenServer({ server, host: HOST, port: 4310, fallback: true, random: () => 0.5 }),
    ).rejects.toBeInstanceOf(NoFreePortError);

    expect(ports).toHaveLength(2 + FALLBACK_PORT_ATTEMPTS);
  });

  it.each([
    {
      what: 'a non-EADDRINUSE error on a default port, even with fallback',
      code: 'EACCES',
      fallback: true,
    },
    { what: 'a taken explicit port, never moving it', code: 'EADDRINUSE', fallback: false },
  ])('rejects $what after one attempt', async ({ code, fallback }) => {
    const server = newServer();
    const ports = spyOnListen(server, () => code, { bind: false });
    const rejection = await listenServer({ server, host: HOST, port: 4310, fallback }).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(rejection).toMatchObject({ code });
    expect(ports).toEqual([4310]);
  });

  it('falls back to the drawn port in the fallback range when port 0 fails', async () => {
    const server = newServer();
    const before = startupListeners(server);
    const ports = spyOnListen(server, (port) => (port === 0 ? 'EADDRINUSE' : undefined), {
      bind: false,
    });

    await listenServer({ server, host: HOST, port: 0, random: () => 0.4321 });

    expect(ports).toEqual([0, portFor(0.4321)]);
    expect(portFor(0.4321)).toBeGreaterThanOrEqual(FALLBACK_PORT_MIN);
    expect(portFor(0.4321)).toBeLessThanOrEqual(FALLBACK_PORT_MAX);
    expect(startupListeners(server)).toEqual(before);
  });

  it('moves to the next random port on each EADDRINUSE, using exactly the drawn ports', async () => {
    const server = newServer();
    const draws = [0, 0.5, 0.9999, 0.2468];
    const next = vi.fn<() => number>();

    for (const draw of draws) next.mockReturnValueOnce(draw);

    const ports = spyOnListen(
      server,
      (port) =>
        port === 0 || draws.slice(0, 3).map(portFor).includes(port) ? 'EADDRINUSE' : undefined,
      { bind: false },
    );

    await listenServer({ server, host: HOST, port: 0, random: next });

    expect(ports).toEqual([0, 20_000, 26_000, 31_999, 22_961]);
    expect(next).toHaveBeenCalledTimes(4);
  });

  it('rejects after exactly the bounded attempts with a no-free-port error keeping the last cause', async () => {
    const server = newServer();
    const before = startupListeners(server);
    const errors: Error[] = [];
    const ports = spyOnListen(server, () => 'EADDRINUSE');
    const emit = server.emit.bind(server);

    vi.spyOn(server, 'emit').mockImplementation(((event: string, ...args: unknown[]) => {
      if (event === 'error') errors.push(args[0] as Error);

      return emit(event, ...args);
    }) as typeof server.emit);

    const rejection = await listenServer({ server, host: HOST, port: 0, random: () => 0.5 }).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(rejection).toBeInstanceOf(NoFreePortError);
    expect((rejection as NoFreePortError).message).toBe(
      `No free port could be found on ${HOST}: the OS gave none (EADDRINUSE) and ${String(FALLBACK_PORT_ATTEMPTS)} fallback ports in ${String(FALLBACK_PORT_MIN)}-${String(FALLBACK_PORT_MAX)} were taken.`,
    );
    expect((rejection as NoFreePortError).cause).toBe(errors.at(-1));
    expect(ports).toHaveLength(1 + FALLBACK_PORT_ATTEMPTS);
    expect(startupListeners(server)).toEqual(before);
  });

  it('rejects a non-EADDRINUSE error on port 0 at once, without fallback', async () => {
    const server = newServer();
    const before = startupListeners(server);
    const ports = spyOnListen(server, () => 'EACCES');

    await expect(listenServer({ server, host: HOST, port: 0 })).rejects.toMatchObject({
      code: 'EACCES',
    });

    expect(ports).toEqual([0]);
    expect(startupListeners(server)).toEqual(before);
  });

  it('rejects a non-EADDRINUSE error on a fallback port at once', async () => {
    const server = newServer();
    const ports = spyOnListen(server, (port) => (port === 0 ? 'EADDRINUSE' : 'EACCES'));

    await expect(
      listenServer({ server, host: HOST, port: 0, random: () => 0.1 }),
    ).rejects.toMatchObject({ code: 'EACCES' });

    expect(ports).toEqual([0, portFor(0.1)]);
  });

  it('removes its listeners when listen throws synchronously', async () => {
    const server = newServer();
    const before = startupListeners(server);
    const thrown = new Error('already listening');

    vi.spyOn(server, 'listen').mockImplementation(() => {
      throw thrown;
    });

    await expect(listenServer({ server, host: HOST, port: 0 })).rejects.toBe(thrown);

    expect(startupListeners(server)).toEqual(before);
  });

  it('really serves on a fallback port when the OS has no ephemeral port', async () => {
    const server = newServer();
    // Real sockets, random ports: a port busy on this machine just moves it to the next draw.
    const ports = spyOnListen(server, (port) => (port === 0 ? 'EADDRINUSE' : undefined));

    await listenServer({ server, host: HOST, port: 0 });

    const { port } = server.address() as AddressInfo;

    expect(ports[0]).toBe(0);
    expect(port).toBeGreaterThanOrEqual(FALLBACK_PORT_MIN);
    expect(port).toBeLessThanOrEqual(FALLBACK_PORT_MAX);
    expect(await (await fetch(`http://${HOST}:${String(port)}`)).text()).toBe('ready');
  });
});
