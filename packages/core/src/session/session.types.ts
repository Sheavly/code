/**
 * Who a run is: every run (the main session and each sub-agent) has an id, and every sub-agent
 * is linked to the session that started it, so none can float free. `rootId` is the main session.
 */
export type SessionRef = {
  id: string;
  /** The session that started this one; absent only for the main session. */
  parentId?: string;
  /** The main session at the top of the tree (its own id for the main session). */
  rootId: string;
  /** 1 for the main session, 2 for its sub-agents, 3 for theirs (the maximum). */
  depth: number;
};

/** Where a session is: still running, or how its run ended. */
export type SessionState = 'running' | 'completed' | 'interrupted' | 'max_turns' | 'failed';

/** A snapshot of a session, for a UI (e.g. a sub-agent card). */
export type SessionInfo = SessionRef & {
  /** Short name, e.g. "Update ESLint rules". */
  title: string;
  /** The last status the agent reported itself (`report_status`), e.g. "editing core package". */
  status?: string;
  state: SessionState;
  startedAt: number;
  endedAt?: number;
};

/** A message waiting in a session's inbox, delivered at its next model call. */
export type InboxMessage = {
  /** Who sent it: `'user'`, or the id of the session that sent it (an ancestor). */
  from: string;
  content: string;
  sentAt: number;
};

/** What a session registry tells its listeners (and what its SSE stream sends). */
export type SessionUpdate =
  | { type: 'session_started'; session: SessionInfo }
  | { type: 'session_status'; session: SessionInfo }
  /** A message was queued for `session`; it sees it at its next model call. */
  | { type: 'session_message'; session: SessionInfo; message: InboxMessage }
  | { type: 'session_ended'; session: SessionInfo };
