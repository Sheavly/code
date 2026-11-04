import type { SessionRegistry } from './sessions.service.js';
import type { SessionId, SessionInfo, SessionRef } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

/** The session a run belongs to: which registry it is tracked in, and which session it is. */
export type RunSession = {
  registry: SessionRegistry;
  ref: SessionRef;
};

/**
 * What a stored conversation leaves for a registry to carry on from (`readStoredLog`): the `seq`
 * the next entry gets, the newest entries as a live log keeps them, and every session as its last
 * update left it.
 */
export type StoredLog = {
  next: number;
  tail: StreamEntry[];
  sessions: SessionInfo[];
};

/**
 * Which entries of the combined stream a listener gets. No `sessionId`: every session's. With
 * one: that session's, and with `subtree` also its sub-agents' (and theirs). `replay` first sends
 * every matching entry so far, so a UI that opens a sub-agent's panel late sees it from its start.
 */
export type EntryFilter = {
  sessionId?: SessionId;
  subtree?: boolean;
  replay?: boolean;
};
