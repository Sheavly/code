import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';

/**
 * What a client may be told about the server that holds the lock: where it is and which version.
 * Never the token: that is the file's, and a message built from this cannot leak it.
 */
export type FirstServer =
  Pick<DiscoveryFile, 'pid' | 'url' | 'serverVersion'> | { unreadable: string };

/**
 * What `ServerPresence.claim` found. Only `held` should stop a server from starting: `unavailable`
 * (the lock or its folder cannot be used, already logged as a warning) lets it run without one.
 */
export type ClaimResult =
  | { status: 'claimed' }
  | { status: 'held'; path: string; first: FirstServer }
  | { status: 'unavailable' };

/** The options of `ServerPresence`. */
export type ServerPresenceParams = {
  /** The Sheavly home: its real path names the lock. */
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  /** The user the runtime folder and the file must belong to; ignored on Windows. */
  uid: number;
  /** Where a warning goes. A message never holds the token. */
  log: (message: string) => void;
};
