import type { ServerPresence } from '@sheavly/storage/discovery-file/server-presence.service';

/** The part of `process` the startup guard uses. */
export type SignalSource = {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
};

/** What `guardStartup` returns. */
export type StartupGuard = {
  /**
   * Says what the start is waiting for: the guard, when a signal comes, lets it finish and then
   * removes the file and releases the lock of the presence it gives. Call it again for each step
   * that takes or writes something.
   */
  track: (work: Promise<ServerPresence | undefined>) => void;
  /**
   * Await it before each step that listens, writes or prints: it settles at once, except after a
   * signal, when it never settles, so a start that is leaving does nothing more.
   */
  proceed: () => Promise<void>;
  /** Takes the handlers off, for the ones that stop a running server to replace them. */
  uninstall: () => void;
};

/**
 * What starting a server found: it may go on (`presence` is undefined when it is not discoverable,
 * and otherwise holds the lock unless that was unavailable, already warned about), or it is
 * refused, with the message to show, because another server holds the lock.
 */
export type PresenceStart =
  { status: 'go'; presence: ServerPresence | undefined } | { status: 'refused'; message: string };
