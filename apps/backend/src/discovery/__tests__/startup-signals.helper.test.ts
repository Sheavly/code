import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ServerPresence } from '@sheavly/storage/discovery-file/server-presence.service';
import { guardStartup } from '../startup-signals.helper.js';

/** A presence that records what was done to it, in order. */
function fakePresence(calls: string[]): ServerPresence {
  return {
    remove: () => Promise.resolve(void calls.push('remove')),
    release: () => Promise.resolve(void calls.push('release')),
  } as unknown as ServerPresence;
}

function setup() {
  const source = new EventEmitter();
  const exits: number[] = [];
  const logged: string[] = [];
  const guard = guardStartup({
    source,
    exit: (code) => void exits.push(code),
    log: (text) => void logged.push(text),
  });
  const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

  return { source, exits, logged, guard, settled };
}

describe('guardStartup', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)(
    'on %s removes the file, then releases the lock, then exits %i',
    async (signal, code) => {
      const { source, exits, guard, settled } = setup();
      const calls: string[] = [];

      guard.track(Promise.resolve(fakePresence(calls)));
      source.emit(signal);
      await settled();

      expect(calls).toEqual(['remove', 'release']);
      expect(exits).toEqual([code]);
    },
  );

  it('exits without a presence when the start has none yet, or none at all', async () => {
    const { source, exits, guard, settled } = setup();

    source.emit('SIGTERM');
    await settled();
    guard.track(Promise.resolve(undefined));
    source.emit('SIGTERM');
    await settled();

    expect(exits).toEqual([143, 143]);
  });

  it('waits for the work in flight, so a lock taken or a file written meanwhile is cleaned up', async () => {
    const { source, exits, guard, settled } = setup();
    const calls: string[] = [];
    const { promise, resolve } = Promise.withResolvers<ServerPresence>();

    guard.track(promise);
    source.emit('SIGTERM');
    await settled();

    expect(exits).toEqual([]);

    resolve(fakePresence(calls));
    await settled();

    expect(calls).toEqual(['remove', 'release']);
    expect(exits).toEqual([143]);
  });

  it('exits at once on a second signal, whatever the first is waiting for', async () => {
    const { source, exits, guard, settled } = setup();

    guard.track(new Promise(() => undefined));
    source.emit('SIGTERM');
    source.emit('SIGINT');
    await settled();

    expect(exits).toEqual([130]);
  });

  it('still exits with the code when the work in flight rejects, and says why', async () => {
    const { source, exits, logged, guard, settled } = setup();

    guard.track(Promise.reject(new Error('lock failed')));
    source.emit('SIGHUP');
    await settled();

    expect(exits).toEqual([129]);
    expect(logged.join('')).toContain('lock failed');
  });

  it('lets the start go on until a signal comes, and never after it', async () => {
    const { source, guard, settled } = setup();
    const steps: string[] = [];

    await guard.proceed();
    steps.push('before the signal');
    source.emit('SIGTERM');
    void guard.proceed().then(() => steps.push('after the signal'));
    await settled();

    expect(steps).toEqual(['before the signal']);
  });

  it('takes its handlers off on uninstall', () => {
    const { source, guard } = setup();

    expect(source.listenerCount('SIGTERM')).toBe(1);
    guard.uninstall();
    expect(source.listenerCount('SIGTERM')).toBe(0);
    expect(source.listenerCount('SIGINT')).toBe(0);
    expect(source.listenerCount('SIGHUP')).toBe(0);
  });
});
