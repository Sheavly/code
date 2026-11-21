import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';
import type { DirectoryDetail } from '../server-runtime/server-runtime.types.js';

/** Why a file was not written. Nothing was written, and nothing that was there was changed. */
export type PublishRefusal =
  | { reason: 'folder'; detail: DirectoryDetail }
  | { reason: 'target-is-folder' }
  | { reason: 'too-large' }
  | { reason: 'invalid-value' };

/**
 * The result of `publishDiscoveryFile`. `failed` carries the error behind it, whose text holds
 * paths only: the token is never in a message.
 */
export type PublishResult =
  | { status: 'published'; path: string }
  | ({ status: 'refused' } & PublishRefusal)
  | { status: 'failed'; cause: unknown };

/** Why a discovery file that exists was not read. Its contents are never part of the reason. */
export type ReadRefusal =
  | { reason: 'folder'; detail: DirectoryDetail }
  | { reason: 'link' | 'not-regular' | 'other-owner' | 'too-open' | 'too-large' }
  | { reason: 'unreadable'; cause?: unknown };

/**
 * The result of `readDiscoveryFile`. Only `found` holds the token; `newer` is a file written by a
 * newer Sheavly, `invalid` one that is not a discovery file of this format.
 */
export type ReadResult =
  | { status: 'found'; value: DiscoveryFile }
  | { status: 'none' }
  | ({ status: 'refused' } & ReadRefusal)
  | { status: 'newer'; formatVersion: number }
  | { status: 'invalid' };

/** The result of `removeDiscoveryFile`: only a file proved to be ours is removed. */
export type RemoveResult =
  | { status: 'removed' }
  | { status: 'left'; reason: 'absent' | 'not-ours' | 'unreadable' }
  | { status: 'failed'; cause: unknown };

/** What each of the three operations takes besides its own values. */
export type DiscoveryPlace = {
  /** The runtime folder `serverRuntimeDirectory` chose. */
  directory: string;
  /** The user the folder and the file must belong to; ignored on Windows. */
  uid: number;
  platform?: NodeJS.Platform;
};
