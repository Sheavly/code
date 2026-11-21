import type { ReadResult } from './discovery-file.types.js';
import type { FirstServer } from './server-presence.types.js';

/**
 * The refusal message of a server that finds another one running: who it is and what to do, or,
 * when its discovery file could not be read, where its lock is and why that is not known. Built
 * from a `FirstServer` alone, so the token can never be in it.
 */
export function describeHeld(params: { path: string; first: FirstServer }): string {
  const { path, first } = params;

  if ('unreadable' in first) {
    return `A Sheavly server holds the lock at ${path}; its discovery file could not be read (${first.unreadable}).`;
  }

  return `Another Sheavly server is already running (pid ${String(first.pid)}, version ${first.serverVersion}, ${originOf(first.url)}). Use it, or stop it first.`;
}

/** Only the origin of a URL is shown: a login, a path or a query in it is not for a terminal. */
function originOf(url: string): string {
  const origin = URL.parse(url)?.origin;

  return origin === undefined || origin === 'null' ? 'unknown address' : origin;
}

/**
 * What the safe reader found, as a `FirstServer`: the three fields a client may show, picked one by
 * one (never the whole file), or why there is nothing to show.
 */
export function firstServerFrom(read: ReadResult): FirstServer {
  if (read.status === 'found') {
    const { pid, url, serverVersion } = read.value;

    return { pid, url, serverVersion };
  }

  if (read.status === 'none') return { unreadable: 'it has not written one yet' };

  if (read.status === 'newer') return { unreadable: 'it was written by a newer Sheavly' };

  if (read.status === 'invalid') return { unreadable: 'it is not a discovery file' };

  return { unreadable: `it was refused: ${read.reason}` };
}
