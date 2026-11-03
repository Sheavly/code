import type { SessionRegistry } from './sessions.service.js';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/** The session a run belongs to: which registry it is tracked in, and which session it is. */
export type RunSession = {
  registry: SessionRegistry;
  ref: SessionRef;
};

/**
 * Which entries of the combined stream a listener gets. No `sessionId`: every session's. With
 * one: that session's, and with `subtree` also its sub-agents' (and theirs). `replay` first sends
 * every matching entry so far, so a UI that opens a sub-agent's panel late sees it from its start.
 */
export type EntryFilter = {
  sessionId?: string;
  subtree?: boolean;
  replay?: boolean;
};
